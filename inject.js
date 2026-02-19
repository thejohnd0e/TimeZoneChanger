(function () {
    const targetTimezone = window.__SPOOF_TZ__;
    if (!targetTimezone) return;

    // ─── Helpers ────────────────────────────────────────────────────────────────

    const _OriginalDate = Date;
    const _OriginalDateTimeFormat = Intl.DateTimeFormat;

    /** Get the UTC offset in minutes for the target timezone at a given timestamp */
    function getOffsetMinutes(ts) {
        const formatter = new _OriginalDateTimeFormat('en-CA', {
            timeZone: targetTimezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(new _OriginalDate(ts));
        const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
        let hour = get('hour');
        if (hour === 24) hour = 0;
        const localMs = _OriginalDate.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
        return (ts - localMs) / 60000;
    }

    /** Get timezone abbreviation (e.g. "PST", "PDT") for the target timezone */
    function getTzAbbr(ts) {
        try {
            const parts = new _OriginalDateTimeFormat('en-US', {
                timeZone: targetTimezone,
                timeZoneName: 'short'
            }).formatToParts(new _OriginalDate(ts));
            return parts.find(p => p.type === 'timeZoneName')?.value || '';
        } catch (e) {
            return '';
        }
    }

    /** Format a date in the target timezone for toString/toTimeString */
    function formatDateString(ts) {
        // Full date string like "Wed Feb 18 2026 03:40:00 GMT-1000 (Hawaii-Aleutian Standard Time)"
        const dateFormatter = new _OriginalDateTimeFormat('en-US', {
            timeZone: targetTimezone,
            weekday: 'short', month: 'short', day: '2-digit', year: 'numeric'
        });
        const timeFormatter = new _OriginalDateTimeFormat('en-US', {
            timeZone: targetTimezone,
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const tzNameFormatter = new _OriginalDateTimeFormat('en-US', {
            timeZone: targetTimezone,
            timeZoneName: 'long'
        });

        const dateParts = dateFormatter.formatToParts(new _OriginalDate(ts));
        const timeParts = timeFormatter.formatToParts(new _OriginalDate(ts));
        const tzNameParts = tzNameFormatter.formatToParts(new _OriginalDate(ts));

        const get = (parts, type) => parts.find(p => p.type === type)?.value || '';

        const weekday = get(dateParts, 'weekday');
        const month = get(dateParts, 'month');
        const day = get(dateParts, 'day');
        const year = get(dateParts, 'year');
        let hour = get(timeParts, 'hour');
        if (hour === '24') hour = '00';
        const minute = get(timeParts, 'minute');
        const second = get(timeParts, 'second');
        const tzName = get(tzNameParts, 'timeZoneName');

        const offsetMin = getOffsetMinutes(ts);
        const sign = offsetMin <= 0 ? '+' : '-';
        const absOffset = Math.abs(offsetMin);
        const offsetHH = String(Math.floor(absOffset / 60)).padStart(2, '0');
        const offsetMM = String(absOffset % 60).padStart(2, '0');
        const gmtOffset = `GMT${sign}${offsetHH}${offsetMM}`;

        return {
            dateStr: `${weekday} ${month} ${day} ${year}`,
            timeStr: `${hour}:${minute}:${second} ${gmtOffset} (${tzName})`,
        };
    }

    // ─── Override Date.prototype.getTimezoneOffset ───────────────────────────────
    Date.prototype.getTimezoneOffset = function () {
        return getOffsetMinutes(this.getTime());
    };

    // ─── Override Date.prototype.toString ───────────────────────────────────────
    Date.prototype.toString = function () {
        if (isNaN(this.getTime())) return 'Invalid Date';
        const { dateStr, timeStr } = formatDateString(this.getTime());
        return `${dateStr} ${timeStr}`;
    };

    // ─── Override Date.prototype.toTimeString ────────────────────────────────────
    Date.prototype.toTimeString = function () {
        if (isNaN(this.getTime())) return 'Invalid Date';
        const { timeStr } = formatDateString(this.getTime());
        return timeStr;
    };

    // ─── Override Date.prototype.toDateString ────────────────────────────────────
    Date.prototype.toDateString = function () {
        if (isNaN(this.getTime())) return 'Invalid Date';
        const { dateStr } = formatDateString(this.getTime());
        return dateStr;
    };

    // ─── Override Date.prototype.toLocaleString ──────────────────────────────────
    const _origToLocaleString = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function (locales, options) {
        options = Object.assign({}, options);
        if (!options.timeZone) options.timeZone = targetTimezone;
        return _origToLocaleString.call(this, locales, options);
    };

    // ─── Override Date.prototype.toLocaleDateString ──────────────────────────────
    const _origToLocaleDateString = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (locales, options) {
        options = Object.assign({}, options);
        if (!options.timeZone) options.timeZone = targetTimezone;
        return _origToLocaleDateString.call(this, locales, options);
    };

    // ─── Override Date.prototype.toLocaleTimeString ──────────────────────────────
    const _origToLocaleTimeString = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (locales, options) {
        options = Object.assign({}, options);
        if (!options.timeZone) options.timeZone = targetTimezone;
        return _origToLocaleTimeString.call(this, locales, options);
    };

    // ─── Override Intl.DateTimeFormat ────────────────────────────────────────────
    // Track which formatters had an explicit timeZone set
    const _explicitTZ = new WeakSet();

    function PatchedDateTimeFormat(locales, options) {
        const opts = Object.assign({}, options);
        const hadExplicitTZ = opts.timeZone !== undefined;
        if (!hadExplicitTZ) {
            opts.timeZone = targetTimezone;
        }
        const instance = new _OriginalDateTimeFormat(locales, opts);
        if (hadExplicitTZ) _explicitTZ.add(instance);
        return instance;
    }

    PatchedDateTimeFormat.prototype = _OriginalDateTimeFormat.prototype;
    PatchedDateTimeFormat.supportedLocalesOf = _OriginalDateTimeFormat.supportedLocalesOf.bind(_OriginalDateTimeFormat);

    // Override resolvedOptions to report our timezone when no explicit one was set
    const _origResolvedOptions = _OriginalDateTimeFormat.prototype.resolvedOptions;
    _OriginalDateTimeFormat.prototype.resolvedOptions = function () {
        const opts = _origResolvedOptions.call(this);
        if (!_explicitTZ.has(this)) {
            opts.timeZone = targetTimezone;
        }
        return opts;
    };

    Object.defineProperty(Intl, 'DateTimeFormat', {
        value: PatchedDateTimeFormat,
        writable: true,
        configurable: true
    });

    // ─── Override Intl.supportedValuesOf (if present) ────────────────────────────
    // Some sites check Intl.supportedValuesOf('timeZone') — leave it as-is since
    // the target timezone is a valid IANA name.

    console.log('[TimeZone Changer] Timezone spoofed to:', targetTimezone);
})();
