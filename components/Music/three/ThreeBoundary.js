import React from 'react';
import Link from 'next/link';

import styles from './ThreeApp.module.scss';

/**
 * The last line of defence for `/3d`.
 *
 * A throw during the render of this page — anywhere in `ThreeApp`, `ThreeHud`
 * or `ThreeStage` — unmounts the whole tree in React, and what is left is the
 * white `html` background with a single minified line in the console. That is
 * the one failure this page must not have, because the visitor has no way to
 * tell it apart from "the site is down".
 *
 * `ThreeStage` already catches the failure it knows about (no WebGL context).
 * This catches everything else, including whatever nobody has thought of yet,
 * and answers with the same card.
 *
 * It is a class because an error boundary still has to be one.
 */
class ThreeBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
        this.handleRetry = this.handleRetry.bind(this);
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // React's own production message is minified; the component stack is
        // the part that says *where*.
        if (typeof console !== 'undefined' && console.error) {
            console.error('3D 页面渲染失败', error, info && info.componentStack);
        }
    }

    handleRetry() {
        // Re-rendering the same children is usually enough: this page's state
        // is all local, and a crash caused by one bad frame or one bad prop
        // does not come back on the next pass.
        this.setState({ error: null });
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        return (
            <div className={styles.crash}>
                <div className={styles.fallback} role="alert">
                    <span className={styles['fallback-mark']} aria-hidden="true">
                        <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M12 8v5M12 16.5v.2" />
                            <path d="M10.3 3.9 2.6 17.4A1.9 1.9 0 0 0 4.3 20.3h15.4a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" />
                        </svg>
                    </span>
                    <p className={styles['fallback-title']}>3D 页面出错了</p>
                    <p className={styles['fallback-text']}>
                        渲染这一页的时候抛了一个异常，页面已经被 React 卸掉了 ——
                        音乐本身没受影响，回简洁版就能继续放。
                    </p>
                    <p className={styles['fallback-detail']}>
                        {(error && (error.message || String(error))) || '未知错误'}
                    </p>
                    <div className={styles['fallback-actions']}>
                        <button
                            type="button"
                            className={styles['fallback-primary']}
                            onClick={this.handleRetry}
                        >
                            再试一次
                        </button>
                        <Link className={styles['fallback-link']} href="/desktop">
                            回简洁版
                        </Link>
                    </div>
                </div>
            </div>
        );
    }
}

export default ThreeBoundary;
