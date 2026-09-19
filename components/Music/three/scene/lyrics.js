import * as THREE from 'three';

/**
 * The lyrics, as an object in the room.
 *
 * Not a DOM panel over the canvas: the whole point of this page is that the
 * words are *in* the scene, floating above the record, at a fixed distance and
 * a fixed angle — so when the camera moves, they move with it the way a real
 * object would. That is also why they are drawn into a canvas rather than laid
 * out in HTML: a `<div>` cannot be lit, cannot be tilted, and cannot sit behind
 * the dust.
 *
 * The cost is that the text is a texture, so it is rasterised once per line at
 * 2048×1024 and reused. Redrawing only on the active line's index keeps that
 * cost to a few draws per song.
 */

const WIDTH = 2048;
const HEIGHT = 1024;
const PLANE_WIDTH = 3;
const PLANE_HEIGHT = PLANE_WIDTH * (HEIGHT / WIDTH);

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, sans-serif';

/** How many lines above and below the active one are drawn. */
const NEIGHBOURS = 2;

export const createLyrics = function () {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        // The words are the one thing in the scene that is *read* rather than
        // looked at. Fog would dim them with distance and the ACES curve would
        // pull the white down to grey, which is right for a lamp and wrong for
        // a lyric sheet — so both are switched off for this material only.
        fog: false,
        toneMapped: false,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), material);
    mesh.position.set(0, 1.62, 0.1);
    mesh.renderOrder = 2;
    mesh.visible = false;

    let lastIndex = -2;
    let lastNotice = null;

    const drawLine = function (text, y, size, alpha, glow) {
        ctx.font = `600 ${size}px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.shadowColor = glow ? 'rgba(250, 35, 59, 0.85)' : 'transparent';
        ctx.shadowBlur = glow ? 34 : 0;
        ctx.fillText(text, WIDTH / 2, y, WIDTH - 160);
        ctx.shadowBlur = 0;
    };

    /**
     * @param {Array<{time:number,text:string}>} lines
     * @param {number} index  index of the line being sung, or -1 for none yet
     * @param {string} notice drawn when the song has no lyrics at all
     */
    const render = function (lines, index, notice) {
        ctx.clearRect(0, 0, WIDTH, HEIGHT);

        if (notice) {
            drawLine(notice, HEIGHT / 2, 64, 0.3, false);
            texture.needsUpdate = true;
            return;
        }

        if (!lines.length) return;

        // The active line sits on the vertical centre, which is also the plane's
        // centre, so it stays put while its neighbours come and go.
        drawLine(lines[index] ? lines[index].text : '', HEIGHT * 0.5, 92, 0.98, true);

        for (let step = 1; step <= NEIGHBOURS; step += 1) {
            const above = lines[index - step];
            const below = lines[index + step];
            // Fade and shrink with distance rather than clipping at a hard
            // edge: the plane has no frame, so an abrupt cut would read as a
            // rendering mistake instead of as "there is more".
            const size = 92 - step * 15;
            const alpha = 0.34 / step;
            if (above) drawLine(above.text, HEIGHT * 0.5 - step * 148, size, alpha, false);
            if (below) drawLine(below.text, HEIGHT * 0.5 + step * 148, size, alpha, false);
        }

        texture.needsUpdate = true;
    };

    return {
        mesh,

        /**
         * @param {boolean} visible   the listener's toggle, and whether the
         *                            song has lyrics at all
         * @param {object|null} lyrics  `{ timed, lines }` from `usePlayer`
         * @param {number} time       current playback position, in seconds
         * @param {string} notice     shown instead of lines
         * @param {number} delta      seconds since the last frame, for the fade
         */
        update(visible, lyrics, time, notice, delta) {
            const lines = lyrics && lyrics.lines ? lyrics.lines : [];
            const index = lyrics && lyrics.timed
                ? lines.findIndex((line, i) => (
                    time >= line.time && (i === lines.length - 1 || time < lines[i + 1].time)
                ))
                : (lyrics ? 0 : -1);

            mesh.visible = visible && Boolean(lyrics || notice);

            // A redraw is only needed when the line changes, but the notice can
            // change while the index does not (a song whose lyrics are still
            // loading becomes a song with none).
            if (mesh.visible && (index !== lastIndex || notice !== lastNotice)) {
                render(lines, index, notice);
                lastIndex = index;
                lastNotice = notice;
            }
            if (!mesh.visible) lastIndex = -2;

            // Fade in and out with the toggle instead of popping. 6 per second
            // is slow enough to read as a dissolve at this size.
            const goal = mesh.visible ? 1 : 0;
            material.opacity += (goal - material.opacity) * Math.min(1, delta * 6);
        },

        dispose() {
            mesh.geometry.dispose();
            material.dispose();
            texture.dispose();
        },
    };
};
