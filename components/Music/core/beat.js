/**
 * A beat detector shared by every consumer of the spectrum.
 *
 * The music's low end carries the beat, but a raw bass value is a bad beat
 * signal: sustained bass notes hold it high, so "bass is loud" fires on every
 * frame of a chorus. The fix is a *floor*: a very slow moving average of the
 * bass, against which the current value must jump clearly before it counts.
 * A short refractory period keeps a double-kick from becoming a blur.
 *
 * The detector is deliberately state-per-instance and framework-free: the
 * nebula and the lyrics each own one, feed it the same smoothed bass, and
 * agree on what a beat was because they agree on the maths.
 */

// How fast the floor follows the bass. Far slower than the attack/release
// smoothing on the value itself: the floor is the *song's* average level, not
// the last frame's.
const FLOOR_RATE = 0.012;

// A kick has to clear the floor by this factor, and be this loud at all, to
// fire. The absolute floor keeps a quiet intro's noise from triggering.
const MARGIN = 1.3;
const MIN_BASS = 0.2;

// No second beat within this window, ms.
const REFRACTORY_MS = 240;

/**
 * @returns {{ update: (now: number, bass: number, playing: boolean) =>
 *   { fired: boolean, amp: number, age: number } }}
 *   `fired` is true once per detected beat; `amp` is the shockwave strength
 *   (decays every frame); `age` is seconds since the last beat, capped.
 */
export const createBeatDetector = function () {
    let floor = 0.12;
    let lastAt = -10_000;
    let amp = 0;

    return {
        update(now, bass, playing) {
            floor += (bass - floor) * FLOOR_RATE;
            let fired = false;
            if (playing && bass > MIN_BASS && bass > floor * MARGIN && now - lastAt > REFRACTORY_MS) {
                lastAt = now;
                amp = Math.min(1.25, 0.4 + (bass - floor) * 1.7);
                fired = true;
            }
            amp *= 0.93;
            return { fired, amp, age: Math.min((now - lastAt) / 1000, 4) };
        },
    };
};
