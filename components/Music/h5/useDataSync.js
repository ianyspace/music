import { useCallback, useEffect, useState } from 'react';

import { flushPending, pendingCount } from '../playStats';
import { flushLikes, pendingLikeCount } from '../likes';

/**
 * The 账号 page's 数据同步 row: how much of the visitor's own data is still
 * only on this device, and the button that pushes it.
 *
 * Two queues feed it, and they are different kinds of thing:
 *
 * - the **play log** (`playStats.js`) is a log of events — a play happened, and
 *   it has to arrive exactly once, so each entry carries its own id;
 * - the **like outbox** (`likes.js`) is a set of desired states — the server
 *   converges on whatever the newest decision was, so a replayed batch is free.
 *
 * They are counted together here because the visitor does not have two kinds of
 * unsent data, they have *unsent data* — and one button that says "N 条待上传"
 * is the whole of what they need to know about it. Flushing is sequential
 * rather than parallel: this is a quiet background chore, not a race.
 *
 * `active` is the panel being on screen, not the hook being mounted — both tab
 * pages stay mounted (see `MusicApp`), and counting the queues on mount would
 * mean reading localStorage for a row nobody is looking at.
 *
 * `revision` is anything that can change the queues *while the row is up*.
 * Confirming a number is the one that matters: it adopts whatever the visitor
 * liked as a guest (`adoptGuestLikes`), which puts entries in the outbox without
 * the visitor pressing anything. Without this the row would still be saying
 * "本地记录已全部上传" over a queue that had just grown. (A play recorded while
 * the panel is open is the other way the count can go stale, and it is left
 * alone: music keeps playing under the panel, the number is refreshed on the
 * next press of 同步, and a live counter for a background chore is not worth a
 * timer.)
 *
 * `ready` is separate from `pending === 0` for the same reason as in
 * `usePlayStats`: before the queues have been counted, "已是最新" would be a
 * claim about a question nobody asked.
 */
const useDataSync = function ({ active, revision }) {
    const [pending, setPending] = useState(0);
    const [ready, setReady] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [notice, setNotice] = useState('');

    useEffect(() => {
        if (!active) return;
        setPending(pendingCount() + pendingLikeCount());
        setReady(true);
    }, [active, revision]);

    /**
     * 同步 — send both queues, then drop exactly what the server acknowledged.
     *
     * The wording follows the outcome rather than a success flag: a partial
     * failure is the interesting case ("some went, some are still here"), and it
     * is the one the visitor can act on by pressing again later.
     */
    const sync = useCallback(async function () {
        setSyncing(true);
        setNotice('');
        try {
            const plays = await flushPending();
            const likes = await flushLikes();
            const sent = plays.sent + likes.sent;
            const remaining = plays.remaining + likes.remaining;
            const error = plays.error || likes.error;
            setPending(remaining);
            if (error && sent === 0) {
                setNotice(`同步失败：${error.message}，记录仍留在本机`);
            } else if (error) {
                setNotice(`已同步 ${sent} 条，还有 ${remaining} 条没成功，稍后再试`);
            } else if (sent > 0) {
                setNotice(`已同步 ${sent} 条，本地记录已清除`);
            } else {
                setNotice('没有待同步的记录');
            }
        } catch (err) {
            // Both flushes report failures as data, so this is for the
            // unexpected — and neither queue is touched by it.
            setNotice(`同步失败：${err.message || err}`);
        } finally {
            setSyncing(false);
        }
    }, []);

    return { pending, ready, syncing, notice, sync };
};

export default useDataSync;
