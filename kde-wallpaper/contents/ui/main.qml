

import QtQuick
import QtQuick.Window
import QtWebSockets
import QtMultimedia
import QtWebEngine
import QtQuick.Effects
import "../code/widgets.js" as W
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    readonly property string screenName: Screen.name

    property var mon: null
    property bool paused: false
    property int fps: 60

    property int webFps: 30

    property date now: new Date()
    property var stats: ({})
    property real quality: 1.0
    property vector3d accent: Qt.vector3d(0.70, 0.36, 1.0)
    property point pointer: Qt.point(-1, -1)
    property real rippleX: 0
    property real rippleY: 0
    property real rippleStart: -100
    property real clock: 0
    property vector2d cursor: Qt.vector2d(0, 0)

    readonly property string kind: mon ? mon.kind : ""


    readonly property string webUrl: kind === "web" && mon ? mon.url : "about:blank"

    readonly property bool halted: paused || (mon !== null && mon.rest === "paused")
    readonly property var gradeRgb: mon && mon.grade ? mon.grade : [1, 1, 1]
    readonly property var rect: mon ? mon.rect : [0, 0, width, height]
    readonly property var canvas: mon ? mon.canvas : [0, 0, width, height]

    function apply(msg) {
        if (msg.t === "state") {
            mon = msg.monitors[screenName] || null;
            paused = msg.paused;
            fps = Math.max(15, Math.min(144, msg.fps));
            quality = msg.quality;
            webFps = msg.webFps !== undefined ? msg.webFps : fps;
            accent = Qt.vector3d(msg.accent[0], msg.accent[1], msg.accent[2]);
            remember.pending = JSON.stringify(msg);
            remember.restart();
        } else if (msg.t === "stats") {
            stats = msg;
        } else if (msg.t === "p") {
            pointer = Qt.point(msg.x, msg.y);
            if (kind === "web") web.pointerTo(msg.x - rect[0], msg.y - rect[1], "mousemove");
        } else if (msg.t === "r") {
            rippleX = msg.x - canvas[0];
            rippleY = msg.y - canvas[1];
            rippleStart = clock;
            if (kind === "web") web.pointerTo(msg.x - rect[0], msg.y - rect[1], "click");
        }
    }

    Component.onCompleted: {
        const last = root.configuration.LastState;
        if (last) {
            try { apply(JSON.parse(last)); } catch (e) {}
        }
    }


    Timer {
        id: remember
        property string pending
        interval: 2000
        onTriggered: {
            if (root.configuration.LastState !== pending) {
                root.configuration.LastState = pending;
                if (root.configuration.writeConfig) root.configuration.writeConfig();
            }
        }
    }

    WebSocket {
        id: feed
        url: "ws://127.0.0.1:47831"
        active: true
        onTextMessageReceived: (text) => {
            try { root.apply(JSON.parse(text)); } catch (e) {}
        }
    }

    Timer {
        interval: 2000
        repeat: true
        running: feed.status !== WebSocket.Open && feed.status !== WebSocket.Connecting
        onTriggered: { feed.active = false; feed.active = true; }
    }


    Timer {
        id: tick
        interval: Math.round(1000 / root.fps)
        repeat: true
        running: !root.halted && (root.kind === "shader" || root.kind === "photo" || (!!root.mon && !!root.mon.overlay)) && root.visible
        property double last: Date.now()
        onRunningChanged: last = Date.now()
        onTriggered: {
            const now = Date.now();
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            root.clock = (root.clock + dt * (root.mon ? root.mon.speed : 1)) % 3600;
            let tx = 0, ty = 0;

            if (root.mon && root.mon.motion === "mouse" && root.pointer.x >= 0) {
                tx = Math.max(-1.5, Math.min(1.5, (root.pointer.x - root.canvas[0]) / root.canvas[2] * 2 - 1));
                ty = Math.max(-1.5, Math.min(1.5, (root.pointer.y - root.canvas[1]) / root.canvas[3] * 2 - 1));
            } else if (root.mon && (root.mon.motion === "drift" || root.mon.motion === "mouse")) {
                const s = now / 1000;
                tx = Math.sin(s * 0.16) * 0.8;
                ty = Math.sin(s * 0.11) * 0.6;
            }
            root.cursor = Qt.vector2d(root.cursor.x + (tx - root.cursor.x) * 0.06, root.cursor.y + (ty - root.cursor.y) * 0.06);
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#07070a"
    }


    Item {
        id: gfx
        anchors.fill: parent
        visible: root.kind === "shader" || root.kind === "photo"
        layer.enabled: visible && root.quality < 0.99
        layer.textureSize: Qt.size(Math.max(1, width * root.quality), Math.max(1, height * root.quality))
        layer.smooth: true

        Image {
            id: photo
            visible: false
            source: root.kind === "photo" ? root.mon.url : ""
            asynchronous: true
            sourceSize: Qt.size(4096, 4096)
        }

        Image {
            id: motionImg
            visible: false
            source: root.kind === "photo" && root.mon.motionUrl ? root.mon.motionUrl : Qt.resolvedUrl("../images/still.png")
            asynchronous: true
        }

        Image {
            id: depthImg
            visible: false
            source: root.kind === "photo" && root.mon.depthUrl ? root.mon.depthUrl : Qt.resolvedUrl("../images/flat.png")
            asynchronous: true
        }

        ShaderEffect {
            id: effect
            anchors.fill: parent
            visible: root.kind === "shader" || (root.kind === "photo" && photo.status === Image.Ready && depthImg.status === Image.Ready && motionImg.status === Image.Ready)
            fragmentShader: root.kind === "shader" ? Qt.resolvedUrl("../shaders/" + root.mon.shader + ".frag.qsb")
                          : root.kind === "photo" ? Qt.resolvedUrl("../shaders/photo.frag.qsb") : ""
            property variant source: photo
            property variant depthMap: depthImg
            property variant motionMap: motionImg

            property vector2d resolution: Qt.vector2d(root.rect[2], root.rect[3])
            property vector2d canvas: Qt.vector2d(root.canvas[2], root.canvas[3])
            property vector2d origin: Qt.vector2d(root.rect[0] - root.canvas[0], root.rect[1] - root.canvas[1])
            property vector2d cursor: root.cursor
            property real time: root.clock
            property real speed: 1
            property real intensity: root.mon ? root.mon.intensity : 1
            property real depth: root.mon ? root.mon.depth : 1
            property vector4d tint: {
                const t = root.mon ? root.mon.tint : "original";
                return t === "accent" ? Qt.vector4d(root.accent.x, root.accent.y, root.accent.z, 1)
                     : t === "mono" ? Qt.vector4d(0, 0, 0, 2) : Qt.vector4d(0, 0, 0, 0);
            }

            property vector4d grade: Qt.vector4d(root.gradeRgb[0], root.gradeRgb[1], root.gradeRgb[2], root.mon && root.mon.life !== undefined ? root.mon.life : 1)
            property vector4d ripple: {
                const age = root.clock - root.rippleStart;
                return age >= 0 && age < 2.5 ? Qt.vector4d(root.rippleX, root.rippleY, age, 1) : Qt.vector4d(0, 0, 0, 0);
            }
        }
    }


    Item {
        anchors.fill: parent
        clip: true
        visible: root.kind === "video"

        MediaPlayer {
            id: player
            source: root.kind === "video" ? root.mon.url : ""
            loops: MediaPlayer.Infinite
            playbackRate: root.mon ? root.mon.speed : 1
            videoOutput: video
            audioOutput: AudioOutput {
                volume: root.mon ? root.mon.volume : 0
                muted: !root.mon || root.mon.volume <= 0
            }
            onSourceChanged: if (source != "" && !root.halted) play()
            onMediaStatusChanged: if (mediaStatus === MediaPlayer.LoadedMedia && !root.halted) play()
        }
        Connections {
            target: root
            function onHaltedChanged() {
                if (root.kind !== "video") return;
                if (root.halted) player.pause(); else player.play();
            }
        }

        VideoOutput {
            id: video
            x: -(root.rect[0] - root.canvas[0])
            y: -(root.rect[1] - root.canvas[1])
            width: root.canvas[2]
            height: root.canvas[3]
            fillMode: VideoOutput.PreserveAspectCrop
        }

        Rectangle {
            anchors.fill: parent
            color: "black"
            opacity: 1 - (root.gradeRgb[0] * 0.3 + root.gradeRgb[1] * 0.59 + root.gradeRgb[2] * 0.11)
        }
    }


    Item {
        anchors.fill: parent
        visible: root.kind === "web"

        Image {
            id: webStill
            anchors.fill: parent
            visible: root.halted
        }

        WebEngineView {
            id: web


            readonly property real res: Math.max(0.25, Math.min(1, root.quality))
            x: 0
            y: 0
            width: parent.width * res
            height: parent.height * res
            zoomFactor: res
            scale: 1 / res
            transformOrigin: Item.TopLeft
            smooth: true
            url: root.webUrl
            backgroundColor: "black"
            audioMuted: !root.mon || !(root.mon.volume > 0)
            settings.localContentCanAccessFileUrls: true
            settings.localContentCanAccessRemoteUrls: true
            settings.playbackRequiresUserGesture: false
            settings.showScrollBars: false
            settings.javascriptCanAccessClipboard: false

            userScripts.collection: [{
                name: "zwall-frame-limit",
                injectionPoint: WebEngineScript.DocumentCreation,
                worldId: WebEngineScript.MainWorld,
                sourceUrl: Qt.resolvedUrl("../code/frame-limit.js")
            }, {
                name: "zwall-we-compat",
                injectionPoint: WebEngineScript.DocumentCreation,
                worldId: WebEngineScript.MainWorld,
                sourceCode: "window.wallpaperRegisterAudioListener = window.wallpaperRegisterAudioListener || function(){};" +
                            "window.wallpaperRegisterMediaStatusListener = window.wallpaperRegisterMediaStatusListener || function(){};" +
                            "window.wallpaperRegisterMediaPropertiesListener = window.wallpaperRegisterMediaPropertiesListener || function(){};" +
                            "window.wallpaperRequestRandomFileForProperty = window.wallpaperRequestRandomFileForProperty || function(){};" +
                            "document.addEventListener('DOMContentLoaded', function(){ var l = window.wallpaperPropertyListener; if (l && l.applyGeneralProperties) try { l.applyGeneralProperties({fps: " + root.fps + "}); } catch (e) {} });"
            }]

            property var pending: null
            function pointerTo(x, y, type) {
                if (type === "click") {
                    runJavaScript("(function(x,y){var el=document.elementFromPoint(x,y)||document.body;" +
                                  "['mousedown','mouseup','click'].forEach(function(t){el.dispatchEvent(new MouseEvent(t,{clientX:x,clientY:y,bubbles:true,view:window}));});})(" + x + "," + y + ")");
                    return;
                }
                pending = [x, y];
                if (!moveTimer.running) moveTimer.start();
            }
            Timer {
                id: moveTimer
                interval: 16
                onTriggered: {
                    const p = web.pending;
                    if (!p) return;
                    web.pending = null;
                    web.runJavaScript("(function(x,y){var o={clientX:x,clientY:y,bubbles:true,view:window};" +
                                      "(document.elementFromPoint(x,y)||document).dispatchEvent(new MouseEvent('mousemove',o));" +
                                      "window.dispatchEvent(new PointerEvent('pointermove',o));})(" + p[0] + "," + p[1] + ")");
                }
            }
            onContextMenuRequested: (request) => request.accepted = true
            function pace() {
                runJavaScript("window.__zwallSetFps && window.__zwallSetFps(" + root.webFps + ")");
            }
            onLoadingChanged: (request) => {
                if (request.status === WebEngineLoadingInfo.LoadSucceededStatus) pace();
            }
            Connections {
                target: root
                function onWebFpsChanged() { web.pace(); }
            }
        }

        Connections {
            target: root
            function onHaltedChanged() {
                if (root.kind !== "web") return;
                if (root.halted) {
                    web.grabToImage((result) => {
                        webStill.source = result.url;
                        web.visible = false;
                        web.lifecycleState = WebEngineView.LifecycleState.Frozen;
                    });
                } else {
                    web.lifecycleState = WebEngineView.LifecycleState.Active;
                    web.visible = true;
                    webStill.source = "";
                }
            }
        }
    }


    Repeater {
        model: root.mon && root.mon.blend ? root.mon.blend : []
        Image {
            readonly property bool across: modelData.side === "left" || modelData.side === "right"
            source: modelData.url
            smooth: true
            asynchronous: true
            fillMode: Image.Stretch
            width: across ? root.width * modelData.size : root.width
            height: across ? root.height : root.height * modelData.size
            x: modelData.side === "right" ? root.width - width : 0
            y: modelData.side === "bottom" ? root.height - height : 0
        }
    }


    ShaderEffect {
        anchors.fill: parent
        visible: !!root.mon && !!root.mon.overlay
        blending: true
        fragmentShader: visible ? Qt.resolvedUrl("../shaders/layer-" + root.mon.overlay + ".frag.qsb") : ""
        property vector2d resolution: Qt.vector2d(root.rect[2], root.rect[3])
        property vector2d canvas: Qt.vector2d(root.canvas[2], root.canvas[3])
        property vector2d origin: Qt.vector2d(root.rect[0] - root.canvas[0], root.rect[1] - root.canvas[1])
        property vector2d cursor: root.cursor
        property real time: root.clock
        property real speed: 1
        property real intensity: root.mon && root.mon.overlayAmount !== undefined ? root.mon.overlayAmount : 1
        property real depth: root.mon ? root.mon.depth : 1
        property vector4d tint: Qt.vector4d(0, 0, 0, 0)
        property vector4d ripple: Qt.vector4d(0, 0, 0, 0)
        property vector4d grade: Qt.vector4d(1, 1, 1, 1)
    }


    Text {
        anchors.centerIn: parent
        visible: !root.mon
        text: feed.status === WebSocket.Open ? "ZWall · drag a wallpaper onto this screen" : "ZWall · start ZWall to play your wallpaper"
        color: "#55ffffff"
        font.pixelSize: 16
    }


    Timer {
        interval: 1000 - (new Date()).getMilliseconds() % 1000
        repeat: true
        running: !!root.mon && !!root.mon.widgets && root.mon.widgets.length > 0
        onTriggered: { root.now = new Date(); interval = 1000 - root.now.getMilliseconds() % 1000 + 5; }
    }
    Repeater {
        model: root.mon && root.mon.widgets ? root.mon.widgets : []
        Item {
            id: wi
            required property var modelData
            readonly property real px: Math.max(8, modelData.size * root.height)
            readonly property bool analog: modelData.kind === "clock" && modelData.style === "analog"
            width: analog ? px * 2.6 : label.implicitWidth
            height: analog ? px * 2.6 : label.implicitHeight
            x: modelData.x * root.width - width / 2
            y: modelData.y * root.height - height / 2
            opacity: modelData.opacity
            layer.enabled: modelData.effect === "shadow" || modelData.effect === "glow"
            layer.effect: MultiEffect {
                shadowEnabled: true
                shadowBlur: wi.modelData.effect === "glow" ? 1.0 : 0.6
                shadowColor: wi.modelData.effect === "glow" ? wi.modelData.color : "#b0000000"
                shadowHorizontalOffset: 0
                shadowVerticalOffset: wi.modelData.effect === "glow" ? 0 : Math.max(1, wi.px * 0.04)
                autoPaddingEnabled: true
            }
            Text {
                id: label
                visible: !wi.analog
                anchors.centerIn: parent
                text: W.text(wi.modelData, root.now, root.stats, Qt.locale())
                color: wi.modelData.color
                font.family: wi.modelData.font || Qt.application.font.family
                font.pixelSize: wi.modelData.kind === "clock" || wi.modelData.kind === "battery" ? wi.px : wi.px * 0.55
                font.weight: wi.modelData.weight
                font.letterSpacing: wi.modelData.style === "minimal" ? -wi.px * 0.02 : 0
                horizontalAlignment: wi.modelData.align === "left" ? Text.AlignLeft : wi.modelData.align === "right" ? Text.AlignRight : Text.AlignHCenter
                lineHeight: 1.1
                renderType: Text.QtRendering
            }
            Canvas {
                visible: wi.analog
                anchors.fill: parent
                property date t: root.now
                onTChanged: requestPaint()
                onWidthChanged: requestPaint()
                onPaint: {
                    const c = getContext("2d");
                    const r = width / 2;
                    c.reset();
                    c.translate(r, r);
                    c.strokeStyle = wi.modelData.color;
                    c.fillStyle = wi.modelData.color;
                    c.lineCap = "round";

                    for (let i = 0; i < 12; i++) {
                        const a = i / 12 * Math.PI * 2;
                        c.lineWidth = Math.max(1, r * (i % 3 === 0 ? 0.035 : 0.018));
                        c.beginPath();
                        c.moveTo(Math.sin(a) * r * 0.86, -Math.cos(a) * r * 0.86);
                        c.lineTo(Math.sin(a) * r * (i % 3 === 0 ? 0.72 : 0.78), -Math.cos(a) * r * (i % 3 === 0 ? 0.72 : 0.78));
                        c.stroke();
                    }
                    const h = t.getHours() % 12 + t.getMinutes() / 60;
                    const m = t.getMinutes() + t.getSeconds() / 60;
                    const hand = (turn, len, w) => {
                        const a = turn * Math.PI * 2;
                        c.lineWidth = w;
                        c.beginPath();
                        c.moveTo(-Math.sin(a) * r * 0.08, Math.cos(a) * r * 0.08);
                        c.lineTo(Math.sin(a) * r * len, -Math.cos(a) * r * len);
                        c.stroke();
                    };
                    hand(h / 12, 0.48, Math.max(2, r * 0.06));
                    hand(m / 60, 0.7, Math.max(1.5, r * 0.04));
                    if (wi.modelData.seconds) hand(t.getSeconds() / 60, 0.78, Math.max(1, r * 0.015));
                    c.beginPath();
                    c.arc(0, 0, Math.max(2, r * 0.045), 0, Math.PI * 2);
                    c.fill();
                }
            }
        }
    }
}
