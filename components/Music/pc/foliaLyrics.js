/**
 * Bridge between **our** lyrics and folia's.
 *
 * The two sides disagree about what a lyric *is*, and this file is the only
 * place that has to know both:
 *
 * - `components/Music/shared.js` `parseLyrics` returns
 *   `{ timed, lines: [{ time, text }] }` — a flat list of lines, timed at the
 *   line level (`.lrc` is all our library has; there is no per-word data).
 * - folia's visualizer consumes `Line[]`, where each line carries
 *   `startTime` / `endTime` / `fullText` **and** `words: Word[]`, each word
 *   timed. Nearly every theme derives its karaoke sweep from `words`, so a line
 *   with a single whole-line word would light up as one block and lose the
 *   effect the themes are built around.
 *
 * So the line's duration is split across its words in proportion to how many
 * graphemes each one has. That is not *true* word timing — nothing in an `.lrc`
 * can be — but it is the same assumption folia's own preview placeholder makes
 * (`PreviewPlaceholder.createCharacterWords`), and it reads correctly: the
 * highlight crosses a line at a steady pace instead of jumping.
 */

// Word segmentation, with a graceful path for engines without `Intl.Segmenter`.
// `granularity: 'word'` is what we want for latin text; for CJK it yields one
// segment per character, which is exactly the unit the sweep should advance by.
const segmentText = function (text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        try {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
            const parts = [];
            for (const part of segmenter.segment(text)) {
                if (part.segment) parts.push(part.segment);
            }
            if (parts.length > 0) return parts;
        } catch (error) {
            /* fall through to the grapheme split */
        }
    }
    return Array.from(text);
};

// How many "advance units" a token is worth. Whitespace counts for nothing: a
// space between two words should not eat a slice of the line's duration.
const weightOf = function (token) {
    const graphemes = Array.from(token);
    let weight = 0;
    graphemes.forEach((char) => {
        if (!/\s/.test(char)) weight += 1;
    });
    return weight;
};

/**
 * Split one line's `[startTime, endTime)` across its words.
 *
 * Zero-weight tokens (a lone space) get a zero-length slice rather than a share,
 * so they can never stall the sweep.
 */
export const buildWords = function (text, startTime, endTime) {
    const tokens = segmentText(text);
    if (tokens.length === 0) return [];

    const weights = tokens.map(weightOf);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const duration = Math.max(0, endTime - startTime);

    // Every token was whitespace — fall back to an even split so the line still
    // has a timeline rather than a single zero-length word.
    if (total <= 0) {
        return tokens.map((token, index) => ({
            text: token,
            startTime: startTime + duration * (index / tokens.length),
            endTime: startTime + duration * ((index + 1) / tokens.length),
        }));
    }

    let consumed = 0;
    return tokens.map((token, index) => {
        const from = startTime + duration * (consumed / total);
        consumed += weights[index];
        const to = startTime + duration * (consumed / total);
        return { text: token, startTime: from, endTime: to };
    });
};

// A last line has no successor to borrow an end time from. Give it a length in
// the same ballpark as the rest of the song instead of a hardcoded constant.
const FALLBACK_LINE_SECONDS = 4;

const averageGap = function (times) {
    if (times.length < 2) return FALLBACK_LINE_SECONDS;
    const span = times[times.length - 1] - times[0];
    const gap = span / (times.length - 1);
    return Number.isFinite(gap) && gap > 0.4 ? gap : FALLBACK_LINE_SECONDS;
};

/**
 * Our parsed lyrics → folia's `Line[]`.
 *
 * Timed lyrics keep their real timestamps. Untimed ones (a plain text file, or
 * a file whose `[mm:ss]` tags the parser could not read) get an even spread
 * across `duration` so the stage still has something to perform — that is what
 * the themes need to exist at all, and it is what the upstream preview does
 * with its own synthetic timeline.
 */
export const toFoliaLines = function (lyrics, duration) {
    if (!lyrics || !Array.isArray(lyrics.lines) || lyrics.lines.length === 0) return [];

    const source = lyrics.lines.filter((line) => line && typeof line.text === 'string' && line.text.length > 0);
    if (source.length === 0) return [];

    if (!lyrics.timed) {
        const total = Number.isFinite(duration) && duration > 0 ? duration : source.length * 3;
        const step = total / source.length;
        return source.map((line, index) => {
            const start = index * step;
            const end = start + step;
            return {
                startTime: start,
                endTime: end,
                fullText: line.text,
                words: buildWords(line.text, start, end),
            };
        });
    }

    const times = source.map((line) => line.time);
    const gap = averageGap(times);
    const lastEnd = Number.isFinite(duration) && duration > 0
        ? Math.max(duration, times[times.length - 1] + 1)
        : times[times.length - 1] + gap;

    return source.map((line, index) => {
        const startTime = line.time;
        // The next line's start is the honest end of this one: `.lrc` marks when
        // a line *begins*, and a line stays up until the next one replaces it.
        const endTime = index + 1 < source.length
            ? Math.max(source[index + 1].time, startTime + 0.1)
            : lastEnd;
        return {
            startTime,
            endTime,
            fullText: line.text,
            words: buildWords(line.text, startTime, endTime),
        };
    });
};

/** folia's `LyricData` wrapper, for the handful of places that want the whole document. */
export const toFoliaLyricData = function (lyrics, { title, artist, duration } = {}) {
    return {
        lines: toFoliaLines(lyrics, duration),
        title: title || undefined,
        artist: artist || undefined,
        isWordByWord: false,
    };
};

/**
 * Index of the line that is playing at `time`, or -1 before the first one.
 *
 * A binary search rather than a scan: this runs on every `timeupdate` *and* on
 * every frame of the app's own clock, and songs with a few hundred lines are
 * normal.
 */
export const findActiveLineIndex = function (lines, time) {
    if (!lines || lines.length === 0) return -1;
    if (time < lines[0].startTime) return -1;

    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].startTime <= time) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found;
};
