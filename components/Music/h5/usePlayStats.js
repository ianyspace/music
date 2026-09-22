import { useCallback, useEffect, useState } from 'react';

import { fetchPlayStats } from '../playStats';

/**
 * The state behind the 听歌排行 page.
 *
 * It sits in `h5/` rather than in `core/` because it is the *only* thing in the
 * app that talks to the play-count API and exactly one screen ever shows it —
 * `core/` is the layouts' shared half, and a ranking only the phone renders
 * does not belong there. (The data layer it wraps,
 * `../playStats`, *is* in the root, because the player — which both trees
 * share — records plays through it.)
 *
 * It is a hook of its own rather than more fields on `usePlayer` for the same
 * reason: `usePlayer` is already the biggest file in the project.
 *
 * `active` is the page being looked at, not the hook being mounted — the phone
 * keeps all three tab pages mounted so their scroll positions survive (see
 * `MusicApp`), which means this would otherwise fetch a ranking on every visit
 * to the song list. It is an argument rather than something the caller gates,
 * because *when* to load is the whole of the interesting behaviour here:
 *
 * - opening the page loads (and re-loads, so the numbers are not from an hour
 *   ago), and leaving it stops nothing — the last answer stays on screen so
 *   coming back is instant;
 * - a play recorded while the page is open is not seen by this hook at all.
 *   That is deliberate: the count it would add is one, and re-fetching on every
 *   song change would be a request per song for a number nobody is watching.
 *   `reload` is the ⟳ button.
 *
 * Uploading what is still only on this device is **not** here. It used to be —
 * this hook carried a queue count and a 同步 button for the card that lived on
 * 账号 — but the page moved out, and the queue is about the visitor's *number*,
 * not about their ranking. It is `useDataSync`, one row on 账号, and it covers
 * both queues (plays and likes) with one button. Keeping a second copy of that
 * logic here would have been two answers to "what is still local".
 */
const usePlayStats = function ({ qq, active }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Bumped by ⟳. A dependency rather than a function call because the load
    // *is* an effect: it has to be cancelled on unmount, and a manual reload
    // has to behave exactly like the automatic one.
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!active) return undefined;
        if (!qq) {
            // Unbound: there is no number to ask about. The page says so; this
            // clears anything a previous number left behind, so binding a new
            // number never shows the old one's rows for a moment.
            setStats(null);
            setError('');
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError('');
        fetchPlayStats(qq)
            .then((data) => { if (!cancelled) setStats(data); })
            .catch((err) => { if (!cancelled) setError(err.message || '读取失败'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [active, qq, reloadKey]);

    const reload = useCallback(function () {
        setReloadKey((key) => key + 1);
    }, []);

    return { stats, loading, error, reload };
};

export default usePlayStats;
