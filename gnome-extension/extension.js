import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PREFIX = 'zwall-surface:';

export default class ZWallExtension extends Extension {
    enable() {
        this._shown = new Map();
        this._watched = new Map();
        this._created = global.display.connect('window-created', (_d, win) => this._consider(win));
        for (const actor of global.get_window_actors())
            this._consider(actor.meta_window);
    }

    disable() {
        global.display.disconnect(this._created);
        for (const [win, ids] of this._watched)
            ids.forEach(id => win.disconnect(id));
        this._watched.clear();
        for (const win of [...this._shown.keys()])
            this._release(win);
    }

    _consider(win, tries = 0) {
        if (!win || this._shown.has(win))
            return;
        if (!(win.get_title() ?? '').startsWith(PREFIX)) {
            if (!this._watched.has(win)) {
                const ids = [
                    win.connect('notify::title', () => this._consider(win)),
                    win.connect('unmanaged', () => this._unwatch(win)),
                ];
                this._watched.set(win, ids);
            }
            return;
        }
        this._unwatch(win);
        const actor = win.get_compositor_private();
        if (!actor) {
            if (tries < 50) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._consider(win, tries + 1);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        const clone = new Clutter.Clone({source: actor, reactive: false});
        clone.add_constraint(new Clutter.BindConstraint({source: actor, coordinate: Clutter.BindCoordinate.POSITION}));

        Main.layoutManager._backgroundGroup.add_child(clone);

        actor.opacity = 0;
        const ids = [
            [actor, actor.connect('notify::opacity', () => {
                if (actor.opacity !== 0)
                    actor.opacity = 0;
            })],
            [win, win.connect('unmanaged', () => this._release(win))],
        ];
        this._shown.set(win, {actor, clone, ids});
    }

    _unwatch(win) {
        const ids = this._watched.get(win);
        if (!ids)
            return;
        ids.forEach(id => win.disconnect(id));
        this._watched.delete(win);
    }

    _release(win) {
        const entry = this._shown.get(win);
        if (!entry)
            return;
        this._shown.delete(win);
        for (const [object, id] of entry.ids)
            object.disconnect(id);
        entry.clone.destroy();

        if (win.get_compositor_private())
            entry.actor.opacity = 255;
    }
}
