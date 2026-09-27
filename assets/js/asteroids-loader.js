(() => {
    const loader = document.currentScript;
    const scriptURL = loader?.dataset.asteroidsScript;
    const styleURL = loader?.dataset.asteroidsStyle;

    if (!scriptURL || !styleURL) return;

    const initialize = () => {
        const launcher = document.querySelector('[data-mascot-play]');
        if (!launcher || !document.querySelector('.content') ||
            !HTMLCanvasElement.prototype.getContext ||
            typeof Intl.Segmenter !== 'function') return;

        let loading;
        let ready = false;
        launcher.disabled = false;
        launcher.setAttribute('aria-label', 'Play Asteroids with the visible text on this page');
        launcher.setAttribute('aria-keyshortcuts', 'Alt+Shift+A');
        launcher.title = 'Play text Asteroids (Alt+Shift+A)';

        const fetchGame = () => {
            if (loading) return loading;
            launcher.setAttribute('aria-busy', 'true');
            loading = Promise.all([
                new Promise((resolve, reject) => {
                    const style = document.createElement('link');
                    style.rel = 'stylesheet';
                    style.href = styleURL;
                    style.onload = resolve;
                    style.onerror = reject;
                    document.head.append(style);
                }),
                new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = scriptURL;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.append(script);
                }),
            ]).then(() => {
                ready = true;
                launcher.removeAttribute('aria-busy');
                launcher.click();
            }).catch((error) => {
                launcher.removeAttribute('aria-busy');
                launcher.disabled = true;
                console.error('Text Asteroids could not load.', error);
            });
            return loading;
        };

        launcher.addEventListener('click', (event) => {
            if (ready) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            fetchGame();
        }, true);

        document.addEventListener('keydown', (event) => {
            if (ready || event.code !== 'KeyA' || !event.altKey || !event.shiftKey ||
                event.ctrlKey || event.metaKey || event.repeat || event.isComposing ||
                event.target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            fetchGame();
        }, true);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
