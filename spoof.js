(function () {
  const targetTimezone = document.documentElement.dataset.tzChanger;
  if (!targetTimezone || window.__TZ_SPOOFED__) return;
  window.__TZ_SPOOFED__ = true;

  const OriginalDate = Date;
  const OriginalDateTimeFormat = Intl.DateTimeFormat;
  const OriginalFetch = window.fetch;
  const explicitTzInstances = new WeakSet();
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

  function getOffsetMinutes(ts) {
    const formatter = new OriginalDateTimeFormat("en-US", {
      timeZone: targetTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(new OriginalDate(ts));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
    let hour = get("hour");
    if (hour === 24) hour = 0;
    const localMs = OriginalDate.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
    return (ts - localMs) / 60000;
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

  const toLocaleLike = (original) =>
    function (locales, options) {
      const next = Object.assign({}, options);
      if (!next.timeZone) next.timeZone = targetTimezone;
      return original.call(this, locales, next);
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

  const resolvedOptions = OriginalDateTimeFormat.prototype.resolvedOptions;
  OriginalDateTimeFormat.prototype.resolvedOptions = function () {
    const result = resolvedOptions.call(this);
    if (!explicitTzInstances.has(this)) result.timeZone = targetTimezone;
    return result;
  };

  const DateTimeFormatProxy = new Proxy(OriginalDateTimeFormat, {
    apply(target, thisArg, args) {
      const [locales, options] = args;
      const opts = Object.assign({}, options);
      const hasExplicit = opts.timeZone !== undefined;
      if (!hasExplicit) opts.timeZone = targetTimezone;
      const instance = Reflect.apply(target, thisArg, [locales, opts]);
      if (hasExplicit) explicitTzInstances.add(instance);
      return instance;
    },
    construct(target, args, newTarget) {
      const [locales, options] = args;
      const opts = Object.assign({}, options);
      const hasExplicit = opts.timeZone !== undefined;
      if (!hasExplicit) opts.timeZone = targetTimezone;
      const instance = Reflect.construct(target, [locales, opts], newTarget);
      if (hasExplicit) explicitTzInstances.add(instance);
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
