import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../config/env.js";
import { READ_TIME_CAP_SECONDS, READ_TIME_FLOOR_SECONDS } from "../../config/analytics.js";
import { addDays, daysBetween, now, setNowForTests, utcDay } from "../../utils/clock.js";
import { looksLikeBot, referrerHost, visitorHash } from "../../utils/visitor.js";
import { readThresholdSeconds } from "../../services/analyticsService.js";
import { handlers } from "../../jobs/handlers.js";
import { QUEUE_OF } from "../../config/queues.js";

describe("the visitor code", () => {
    const ua = "Mozilla/5.0 (Probe)";

    it("is the same for the same visitor within a day, and different for another browser or another address", () => {
        const first = visitorHash("203.0.113.7", ua, "2026-03-01");

        assert.equal(visitorHash("203.0.113.7", ua, "2026-03-01"), first);
        assert.notEqual(visitorHash("203.0.113.7", "Another/1.0", "2026-03-01"), first);
        assert.notEqual(visitorHash("203.0.113.8", ua, "2026-03-01"), first);
    });

    it("changes every day, so a person cannot be followed from one day to the next", () => {
        assert.notEqual(visitorHash("203.0.113.7", ua, "2026-03-01"), visitorHash("203.0.113.7", ua, "2026-03-02"));
    });

    it("is short, hexadecimal, and contains neither the address nor the browser", () => {
        const code = visitorHash("203.0.113.7", ua, "2026-03-01");

        assert.match(code, /^[0-9a-f]{32}$/);
        assert.ok(!code.includes("203") && !code.toLowerCase().includes("probe"));
    });

    it("cannot be reproduced without the server secret", () => {
        const original = env.JWT_SECRET;
        const before = visitorHash("203.0.113.7", ua, "2026-03-01");
        env.JWT_SECRET = `${original}-different`;
        try {
            assert.notEqual(visitorHash("203.0.113.7", ua, "2026-03-01"), before);
        } finally {
            env.JWT_SECRET = original;
        }
    });
});

describe("referring sites", () => {
    it("keeps only the hostname: no path, query, fragment, port or www", () => {
        assert.equal(referrerHost("https://www.News.Example.com:8443/a/b?token=secret#top"), "news.example.com");
        assert.equal(referrerHost("http://example.org"), "example.org");
    });

    it("says (direct) for none, (internal) for our own site, and (other) for anything odd", () => {
        assert.equal(referrerHost(""), "(direct)");
        assert.equal(referrerHost(undefined), "(direct)");
        assert.equal(referrerHost(null), "(direct)");
        assert.equal(referrerHost(`${env.APP_URL}/blog/x`), "(internal)");
        assert.equal(referrerHost("https://www.localhost/anything"), "(internal)", "www is ignored when comparing with our own host");
        for (const odd of ["not a url", "javascript:alert(1)", "ftp://example.com/file", "data:text/html,hi", "https://exa mple.com", `https://${"a".repeat(120)}.com/`]) {
            assert.equal(referrerHost(odd), "(other)", String(odd).slice(0, 30));
        }
    });
});

describe("telling readers from robots", () => {
    it("ignores clients that announce themselves, and clients with no browser string at all", () => {
        for (const robot of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "facebookexternalhit/1.1", "curl/8.1.0", "python-requests/2.31", "HeadlessChrome/120", "Slackbot-LinkExpanding 1.0", "", undefined]) {
            assert.equal(looksLikeBot(robot), true, String(robot));
        }
    });

    it("lets ordinary browsers through", () => {
        for (const browser of ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "node-superagent/10.0.0"]) {
            assert.equal(looksLikeBot(browser), false, browser.slice(0, 30));
        }
    });
});

describe("what counts as a read", () => {
    it("asks for 40 percent of the reading time, never under 10 seconds and never over 60", () => {
        assert.equal(readThresholdSeconds(1), 24);
        assert.equal(readThresholdSeconds(2), 48);
        assert.equal(readThresholdSeconds(0), READ_TIME_FLOOR_SECONDS);
        assert.equal(readThresholdSeconds(30), READ_TIME_CAP_SECONDS);
        assert.equal(readThresholdSeconds(undefined), 24, "a story with no reading time is treated as one minute");
    });
});

describe("days", () => {
    it("works in UTC, whatever the machine's time zone", () => {
        assert.equal(utcDay(new Date("2026-03-01T23:59:59.999Z")), "2026-03-01");
        assert.equal(utcDay(new Date("2026-03-02T00:00:00.000Z")), "2026-03-02");
    });

    it("adds days across month and year ends, and lists every day of a range", () => {
        assert.equal(addDays("2026-02-27", 3), "2026-03-02");
        assert.equal(addDays("2026-01-01", -1), "2025-12-31");
        assert.deepEqual(daysBetween("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
        assert.equal(daysBetween("2026-03-01", "2026-03-01").length, 1);
    });

    it("can be pinned for a test and let go again", () => {
        setNowForTests("2026-06-15T12:00:00Z");
        try {
            assert.equal(utcDay(now()), "2026-06-15");
        } finally {
            setNowForTests(null);
        }
        assert.notEqual(utcDay(now()), "2026-06-15");
    });
});

describe("the daily purge job", () => {
    it("is known to the queue and has a handler", () => {
        assert.equal(QUEUE_OF["purge-analytics"], "maintenance");
        assert.equal(typeof handlers["purge-analytics"], "function");
    });
});
