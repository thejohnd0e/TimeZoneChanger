(function () {
    // Читаем зону из атрибута скрипта или глобальной переменной
    const targetTimezone = document.documentElement.dataset.tzChanger;
    if (!targetTimezone || window.__TZ_SPOOFED__) return;
    window.__TZ_SPOOFED__ = true;

    const _Date = Date;
    const _Intl = Intl.DateTimeFormat;

    function getParts(date, timeZone) {
        try {
            const f = new _Intl('en-US', {
                timeZone, hour12: false, weekday: 'short', month: 'short', day: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'long'
            });
            return f.formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
        } catch (e) { return {}; }
    }

    // Смещение в минутах
    Date.prototype.getTimezoneOffset = function () {
        const p = getParts(this, targetTimezone);
        if (!p.year) return _Date.prototype.getTimezoneOffset.call(this);
        const l = Date.UTC(p.year, p.month - 1, p.day, p.hour >= 24 ? 0 : p.hour, p.minute, p.second);
        return (this.getTime() - l) / 60000;
    };

    const formatFull = (d) => {
        const p = getParts(d, targetTimezone);
        if (!p.year) return d.toString();
        const off = -d.getTimezoneOffset();
        const sign = off >= 0 ? '+' : '-';
        const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
        const mm = String(Math.abs(off) % 60).padStart(2, '0');
        return `${p.weekday} ${p.month} ${p.day} ${p.year} ${p.hour}:${p.minute}:${p.second} GMT${sign}${hh}${mm} (${p.timeZoneName})`;
    };

    Date.prototype.toString = function () { return isNaN(this.getTime()) ? 'Invalid Date' : formatFull(this); };
    Date.prototype.toTimeString = function () { return isNaN(this.getTime()) ? 'Invalid Date' : formatFull(this).split(' ').slice(4).join(' '); };

    // Патчим Intl.DateTimeFormat и его resolvedOptions
    const _origDateTimeFormat = Intl.DateTimeFormat;
    window.Intl.DateTimeFormat = function (locales, options) {
        const newOptions = Object.assign({}, options);
        if (!newOptions.timeZone) newOptions.timeZone = targetTimezone;
        const instance = new _origDateTimeFormat(locales, newOptions);

        // Переопределяем resolvedOptions для каждого экземпляра
        const origResolved = instance.resolvedOptions;
        instance.resolvedOptions = function () {
            const res = origResolved.call(this);
            if (!options || !options.timeZone) res.timeZone = targetTimezone;
            return res;
        };
        return instance;
    };
    window.Intl.DateTimeFormat.prototype = _origDateTimeFormat.prototype;
    window.Intl.DateTimeFormat.supportedLocalesOf = _origDateTimeFormat.supportedLocalesOf;

    // Патчим методы локали
    const patchLocale = (method) => {
        const orig = _Date.prototype[method];
        _Date.prototype[method] = function (loc, opt) {
            return orig.call(this, loc, Object.assign({ timeZone: targetTimezone }, opt));
        };
    };
    patchLocale('toLocaleString');
    patchLocale('toLocaleDateString');
    patchLocale('toLocaleTimeString');

    console.log('[TZ] Spoof active:', targetTimezone);
})();
