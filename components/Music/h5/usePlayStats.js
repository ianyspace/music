import { useCallback, useEffect, useState } from 'react';

import { fetchPlayStats, flushPending, pendingCount } from '../playStats';

/**
 * The state behind the 账号 page's 听歌排行 card.
 *
 * It sits in `h5/` rather than in `core/` because it is the *only* thing in the
 * app that talks to the play-count API and exactly one screen ever shows it —
 * `core/` is the three layouts' shared half, and a ranking the wide screen and
 * the 3D tree cannot render does not belong there. (The data layer it wraps,
 * `../playStats`, *is* in the root, because the player — which all three trees
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
 *   `reload` is the ⟳ button, and 同步 reloads for the same reason.
 *
 * Sync is offered here and nowhere else: the log is per-browser, so the only
 * person who can decide "send what is pending now" is the visitor looking at
 * their own page — and it is the same page that says how much is pending.
 */
const usePlayStats = function ({ qq, active }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // How many plays are sitting in the local log. Refreshed when the page
    // opens and after every sync — the two moments it can have changed without
    // this hook doing anything.
    //
    // `ready` is separate from `pending === 0` on purpose. The card is mounted
    // long before it is ever looked at (all three tab pages stay mounted), and
    // until this hook has run once it has *not counted* the log — it has no
    // answer, which is not the same as "nothing pending". The page says nothing
    // about the log until `ready`, so it can never claim "已全部上传" about a
    // question it has not asked.
    const [pending, setPending] = useState(0);
    const [ready, setReady] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncNotice, setSyncNotice] = useState('');
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!active) return undefined;
        setPending(pendingCount());
        setReady(true);
        if (!qq) {
            // Unbound: there is no number to ask about. The card says so; this
            // clears anything a previous number left behind.
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

    /**
     * 同步 — send the local log, then delete what the server confirmed.
     *
     * The wording follows the outcome rather than a success flag: a partial
     * failure is the interesting case ("some went, some are still here"), and
     * it is the one the visitor can act on by pressing again later.
     */
    const sync = useCallback(async function () {
        setSyncing(true);
        setSyncNotice('');
        try {
            const result = await flushPending();
            setPending(result.remaining);
            if (result.error && result.sent === 0) {
                setSyncNotice(`同步失败：${result.error.message}，记录仍留在本机`);
            } else if (result.error) {
                setSyncNotice(`已同步 ${result.sent} 条，还有 ${result.remaining} 条没成功，稍后再试`);
            } else if (result.sent > 0) {
                setSyncNotice(`已同步 ${result.sent} 条，本地记录已清除`);
            } else {
                setSyncNotice('没有待同步的记录');
            }
            // A successful sync just changed the ranking this page shows.
            if (result.sent > 0) setReloadKey((key) => key + 1);
        } catch (err) {
            // `flushPending` reports failures as data, so this is for the
            // unexpected — and the log is untouched either way.
            setSyncNotice(`同步失败：${err.message || err}`);
        } finally {
            setSyncing(false);
        }
    }, []);

    return { stats, loading, error, reload, pending, ready, syncing, syncNotice, sync };
};

export default usePlayStats;
