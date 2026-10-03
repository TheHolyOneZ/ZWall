

.pragma library

function pad(n) {
    return (n < 10 ? "0" : "") + n;
}

var WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];


function words(d) {
    var m = Math.round(d.getMinutes() / 5) * 5;
    var h = d.getHours() % 12;
    if (m === 60) { m = 0; h = (h + 1) % 12; }
    var next = WORDS[(h + 1) % 12];
    var hour = WORDS[h];
    var names = { 5: "five", 10: "ten", 15: "quarter", 20: "twenty", 25: "twenty-five", 30: "half" };
    if (m === 0) return hour + " o'clock";
    if (m <= 30) return names[m] + " past " + hour;
    return names[60 - m] + " to " + next;
}

function clock(w, d) {
    if (w.style === "words") return words(d);
    var h = d.getHours();
    var suffix = "";
    if (!w.hour24) { suffix = h < 12 ? " am" : " pm"; h = h % 12 || 12; }
    var t = (w.hour24 ? pad(h) : String(h)) + ":" + pad(d.getMinutes()) + (w.seconds ? ":" + pad(d.getSeconds()) : "");
    return w.style === "minimal" ? t : t + suffix;
}

function date(w, d, locale) {
    var day = locale.dayName(d.getDay(), 0);
    var month = locale.monthName(d.getMonth(), 0);
    if (w.style === "short") return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
    if (w.style === "weekday") return day;
    return day + ", " + d.getDate() + " " + month;
}

function system(w, s) {
    var out = [];
    var m = w.metrics || [];
    if (m.indexOf("cpu") >= 0) out.push("CPU " + (s.cpu !== undefined ? s.cpu : "–") + "%");
    if (m.indexOf("ram") >= 0) out.push("RAM " + (s.ramTotal ? (s.ramUsed / 1024).toFixed(1) + " / " + (s.ramTotal / 1024).toFixed(0) + " GB" : "–"));
    if (m.indexOf("uptime") >= 0) {
        var u = s.uptime || 0;
        out.push("Up " + Math.floor(u / 86400) + "d " + Math.floor((u % 86400) / 3600) + "h");
    }
    return out.join(w.align === "center" ? "  ·  " : "\n");
}

function battery(s) {
    if (s.battery === null || s.battery === undefined) return "No battery";
    return s.battery + "%" + (s.charging ? " ⚡" : "");
}

function text(w, d, s, locale) {
    if (w.kind === "clock") return clock(w, d);
    if (w.kind === "date") return date(w, d, locale);
    if (w.kind === "system") return system(w, s || {});
    if (w.kind === "battery") return battery(s || {});
    return w.text || "";
}
