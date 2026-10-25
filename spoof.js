(function () {
  const targetTimezone = document.documentElement.dataset.tzChanger;
  if (!targetTimezone || window.__TZ_SPOOFED__) return;
  window.__TZ_SPOOFED__ = true;

  const OriginalDate = Date;
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  const OriginalFetch = window.fetch;
  let activeNetworkOps = 0;

  function notifyNetwork(type) {
    document.dispatchEvent(new CustomEvent("__tzc_network__", { detail: { type } }));
  }

  function beginNetworkOp() {
    activeNetworkOps += 1;
    if (activeNetworkOps === 1) notifyNetwork("start");
  }

  function endNetworkOp() {
    activeNetworkOps = Math.max(0, activeNetworkOps - 1);
    if (activeNetworkOps === 0) notifyNetwork("end");
  }

  const offsetFormatter = new OriginalDateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone: targetTimezone, era: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });

  function getOffsetMilliseconds(ts) {
    if (!Number.isFinite(ts)) return NaN;
    const parts = offsetFormatter.formatToParts(new OriginalDate(ts));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    const year = parts.find((p) => p.type === "era")?.value === "BC" ? 1 - get("year") : get("year");
    // Keep intermediate Dates within TimeClip even at the Date range limits.
    const cycles = Math.floor((year - 2000) / 400);
    const local = new OriginalDate(0);
    local.setUTCFullYear(year - cycles * 400, get("month") - 1, get("day"));
    local.setUTCHours(get("hour"), get("minute"), get("second"), 0);
    return Math.floor(ts / 1000) * 1000 - (local.getTime() + cycles * 146097 * 86400000);
  }

  function getOffsetMinutes(ts) {
    const offset = Math.trunc(getOffsetMilliseconds(ts) / 60000);
    return offset === 0 ? 0 : offset;
  }

  function localDate(ts) {
    return new OriginalDate(ts - getOffsetMilliseconds(ts));
  }

  // Resolve local wall time using offsets on both sides of nearby transitions.
  // Overlap: choose the earlier instant. Gap: advance by the transition gap.
  function fromLocalTime(wallTime) {
    if (!Number.isFinite(wallTime)) return NaN;
    const offsets = new Set([-2, 0, 2].map((days) => getOffsetMilliseconds(Math.max(-8640000000000000, Math.min(8640000000000000, wallTime + days * 86400000)))));
    const candidates = [...offsets].map((offset) => wallTime + offset).filter(Number.isFinite);
    const exact = candidates.filter((ts) => ts - getOffsetMilliseconds(ts) === wallTime);
    if (exact.length) return Math.min(...exact);
    const after = candidates.map((ts) => ({ ts, delta: ts - getOffsetMilliseconds(ts) - wallTime }))
      .filter(({ delta }) => delta >= 0).sort((a, b) => a.delta - b.delta);
    return after[0]?.ts ?? NaN;
  }

  function formatDate(ts) {
    const dateFormatter = new OriginalDateTimeFormat("en-US", {
      timeZone: targetTimezone,
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric"
    });
    const timeFormatter = new OriginalDateTimeFormat("en-US", {
      timeZone: targetTimezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const tzNameFormatter = new OriginalDateTimeFormat("en-US", {
      timeZone: targetTimezone,
      timeZoneName: "long"
    });

    const getPart = (parts, type) => parts.find((p) => p.type === type)?.value || "";
    const dateParts = dateFormatter.formatToParts(new OriginalDate(ts));
    const timeParts = timeFormatter.formatToParts(new OriginalDate(ts));
    const tzParts = tzNameFormatter.formatToParts(new OriginalDate(ts));

    let hour = getPart(timeParts, "hour");
    if (hour === "24") hour = "00";
    const offset = getOffsetMinutes(ts);
    const sign = offset <= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    const gmt = `GMT${sign}${hh}${mm}`;

    return {
      dateStr: `${getPart(dateParts, "weekday")} ${getPart(dateParts, "month")} ${getPart(dateParts, "day")} ${getPart(dateParts, "year")}`,
      timeStr: `${hour}:${getPart(timeParts, "minute")}:${getPart(timeParts, "second")} ${gmt} (${getPart(tzParts, "timeZoneName")})`
    };
  }

  function timezoneOptions(options) {
    if (options === null) throw new TypeError("Options cannot be null");
    const next = Object.create(options === undefined ? null : Object(options));
    if (next.timeZone === undefined) {
      Object.defineProperty(next, "timeZone", { value: targetTimezone, configurable: true });
    }
    return next;
  }

  const toLocaleLike = (original) =>
    function (locales, options) {
      return original.call(this, locales, timezoneOptions(options));
    };

  Date.prototype.getTimezoneOffset = function () {
    return getOffsetMinutes(this.getTime());
  };

  Date.prototype.toString = function () {
    if (isNaN(this.getTime())) return "Invalid Date";
    const parts = formatDate(this.getTime());
    return `${parts.dateStr} ${parts.timeStr}`;
  };

  Date.prototype.toDateString = function () {
    if (isNaN(this.getTime())) return "Invalid Date";
    return formatDate(this.getTime()).dateStr;
  };

  Date.prototype.toTimeString = function () {
    if (isNaN(this.getTime())) return "Invalid Date";
    return formatDate(this.getTime()).timeStr;
  };

  Date.prototype.toLocaleString = toLocaleLike(Date.prototype.toLocaleString);
  Date.prototype.toLocaleDateString = toLocaleLike(Date.prototype.toLocaleDateString);
  Date.prototype.toLocaleTimeString = toLocaleLike(Date.prototype.toLocaleTimeString);

  for (const suffix of ["FullYear", "Month", "Date", "Day", "Hours", "Minutes", "Seconds", "Milliseconds"]) {
    const utcGetter = OriginalDate.prototype[`getUTC${suffix}`];
    OriginalDate.prototype[`get${suffix}`] = function () {
      const ts = OriginalDate.prototype.getTime.call(this);
      const local = localDate(ts);
      if (!Number.isFinite(ts) || Number.isFinite(local.getTime())) return utcGetter.call(local);
      const parts = offsetFormatter.formatToParts(new OriginalDate(ts));
      const get = (type) => Number(parts.find((p) => p.type === type)?.value);
      const year = parts.find((p) => p.type === "era")?.value === "BC" ? 1 - get("year") : get("year");
      const fields = { FullYear: year, Month: get("month") - 1, Date: get("day"),
        Day: ((Math.floor((ts - getOffsetMilliseconds(ts)) / 86400000) + 4) % 7 + 7) % 7,
        Hours: get("hour"), Minutes: get("minute"), Seconds: get("second"), Milliseconds: ((ts % 1000) + 1000) % 1000 };
      return fields[suffix];
    };
  }
  OriginalDate.prototype.getYear = function () { return this.getFullYear() - 1900; };

  for (const suffix of ["FullYear", "Month", "Date", "Hours", "Minutes", "Seconds", "Milliseconds"]) {
    const utcSetter = OriginalDate.prototype[`setUTC${suffix}`];
    OriginalDate.prototype[`set${suffix}`] = function (...args) {
      const ts = OriginalDate.prototype.getTime.call(this);
      const local = Number.isNaN(ts) && suffix === "FullYear" ? new OriginalDate(0) : localDate(ts);
      utcSetter.apply(local, args);
      return OriginalDate.prototype.setTime.call(this, fromLocalTime(local.getTime()));
    };
  }
  OriginalDate.prototype.setYear = function (year) {
    let value = +year;
    if (!Number.isNaN(value)) {
      value = Math.trunc(value);
      if (value >= 0 && value <= 99) value += 1900;
    }
    return OriginalDate.prototype.setFullYear.call(this, value);
  };

  function parseDate(value) {
    const text = `${value}`.trim();
    // ISO date-only forms are UTC; explicit offsets must remain absolute.
    const dateOnly = /^[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?$/.test(text);
    const explicit = /(?:z|[+-]\d{2}:?\d{2})\s*$/i.test(text) || /\b(?:GMT|UTC|[ECMP][SD]T)\b/i.test(text);
    if (dateOnly || explicit) return OriginalDate.parse(text);
    const wall = OriginalDate.parse(text.includes("T") ? `${text}Z` : `${text} UTC`);
    return fromLocalTime(wall);
  }

  function primitive(value) {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    const convert = value[Symbol.toPrimitive];
    if (convert !== undefined && convert !== null) {
      const result = convert.call(value, "default");
      if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
      throw new TypeError("Cannot convert object to primitive value");
    }
    for (const key of ["valueOf", "toString"]) {
      if (typeof value[key] !== "function") continue;
      const result = value[key]();
      if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
    }
    throw new TypeError("Cannot convert object to primitive value");
  }

  const DateProxy = new Proxy(OriginalDate, {
    apply() { return new OriginalDate().toString(); },
    construct(target, args, newTarget) {
      if (args.length === 0) return Reflect.construct(target, [], newTarget);
      if (args.length >= 2) return Reflect.construct(target, [fromLocalTime(OriginalDate.UTC(...args.slice(0, 7)))], newTarget);
      let value;
      // Native Date copies another Date's internal timestamp without coercion.
      try { value = OriginalDate.prototype.getTime.call(args[0]); }
      catch (_) { value = primitive(args[0]); }
      return Reflect.construct(target, [typeof value === "string" ? parseDate(value) : value], newTarget);
    },
    get(target, key, receiver) {
      return key === "parse" ? parseDate : Reflect.get(target, key, receiver);
    }
  });
  Object.defineProperty(OriginalDate.prototype, "constructor", { value: DateProxy, configurable: true, writable: true });
  window.Date = DateProxy;

  const DateTimeFormatProxy = new Proxy(OriginalDateTimeFormat, {
    apply(target, thisArg, args) {
      const [locales, options] = args;
      const opts = timezoneOptions(options);
      const instance = Reflect.apply(target, thisArg, [locales, opts]);
      return instance;
    },
    construct(target, args, newTarget) {
      const [locales, options] = args;
      const opts = timezoneOptions(options);
      const instance = Reflect.construct(target, [locales, opts], newTarget);
      return instance;
    }
  });

  Object.defineProperty(Intl, "DateTimeFormat", {
    value: DateTimeFormatProxy,
    configurable: true,
    writable: true
  });

  if (typeof OriginalFetch === "function") {
    window.fetch = new Proxy(OriginalFetch, {
      apply(target, thisArg, args) {
        beginNetworkOp();
        try {
          const result = Reflect.apply(target, thisArg, args);
          if (result && typeof result.finally === "function") {
            return result.finally(endNetworkOp);
          }
          endNetworkOp();
          return result;
        } catch (err) {
          endNetworkOp();
          throw err;
        }
      }
    });
  }

  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    beginNetworkOp();
    this.addEventListener("loadend", endNetworkOp, { once: true });
    return originalXhrSend.apply(this, arguments);
  };
})();
