document.addEventListener("DOMContentLoaded", () => {
    const outlines = document.querySelectorAll("[data-post-outline]");
    const topLinks = document.querySelectorAll("[data-scroll-top]");
    const mobileOutlineMedia = window.matchMedia("(max-width: 979px)");
    let flashedHeading = null;
    let flashedOutlineControl = null;
    let flashTimeout = null;

    const isFloatingOutline = () => mobileOutlineMedia.matches;

    const setOutlineOpen = (outline, isOpen) => {
        outline.dataset.outlineOpen = isOpen ? "true" : "false";

        const toggle = outline.querySelector("[data-outline-toggle]");
        const panel = outline.querySelector("[data-outline-panel]");

        if (toggle) {
            toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        }

        if (panel) {
            panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
        }
    };

    const syncOutlineMode = () => {
        for (const outline of outlines) {
            const panel = outline.querySelector("[data-outline-panel]");

            if (!panel) {
                continue;
            }

            if (isFloatingOutline()) {
                setOutlineOpen(outline, outline.dataset.outlineOpen === "true");
            } else {
                panel.setAttribute("aria-hidden", "false");
            }
        }
    };

    const closeOutline = (control, delay = 180) => {
        if (!isFloatingOutline()) {
            return;
        }

        const outline = control?.closest?.("[data-post-outline]");

        if (!outline) {
            return;
        }

        window.setTimeout(() => {
            setOutlineOpen(outline, false);
        }, delay);
    };

    const clearFlashes = () => {
        if (flashTimeout) {
            window.clearTimeout(flashTimeout);
            flashTimeout = null;
        }

        if (flashedHeading) {
            flashedHeading.classList.remove("heading-flash");
            flashedHeading = null;
        }

        if (flashedOutlineControl) {
            flashedOutlineControl.classList.remove("heading-flash");
            flashedOutlineControl = null;
        }
    };

    const flashOutlineTarget = (heading = null, outlineControl = null) => {
        clearFlashes();

        if (heading) {
            // Force a reflow so repeated clicks on the same heading restart the flash.
            void heading.offsetWidth;
            heading.classList.add("heading-flash");
            flashedHeading = heading;
        }

        if (outlineControl) {
            void outlineControl.offsetWidth;
            outlineControl.classList.add("heading-flash");
            flashedOutlineControl = outlineControl;
        }

        flashTimeout = window.setTimeout(() => {
            clearFlashes();
        }, 500);
    };

    for (const outline of outlines) {
        const toggle = outline.querySelector("[data-outline-toggle]");

        if (!toggle) {
            continue;
        }

        toggle.addEventListener("click", (event) => {
            event.preventDefault();
            setOutlineOpen(outline, outline.dataset.outlineOpen !== "true");
        });
    }

    for (const topLink of topLinks) {
        topLink.addEventListener("click", (event) => {
            event.preventDefault();
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            flashOutlineTarget(null, topLink);
            closeOutline(topLink);
        });
    }

    document.addEventListener("click", (event) => {
        if (!isFloatingOutline()) {
            return;
        }

        for (const outline of outlines) {
            if (!outline.contains(event.target)) {
                setOutlineOpen(outline, false);
            }
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }

        for (const outline of outlines) {
            setOutlineOpen(outline, false);
        }
    });

    if (typeof mobileOutlineMedia.addEventListener === "function") {
        mobileOutlineMedia.addEventListener("change", () => {
            for (const outline of outlines) {
                outline.dataset.outlineOpen = "false";
            }

            syncOutlineMode();
        });
    }

    window.addEventListener("resize", syncOutlineMode);

    window.flashTocTarget = (tocLink) => {
        const href = tocLink?.getAttribute?.("href");

        if (!href || !href.startsWith("#")) {
            flashOutlineTarget(null, tocLink);
            closeOutline(tocLink);
            return;
        }

        const targetId = decodeURIComponent(href.slice(1));
        const targetHeading = document.getElementById(targetId);

        if (
            !targetHeading ||
            !targetHeading.matches(".post-article h2, .post-article h3, .post-article h4, .post-article h5, .post-article h6")
        ) {
            flashOutlineTarget(null, tocLink);
            closeOutline(tocLink);
            return;
        }

        window.setTimeout(() => {
            flashOutlineTarget(targetHeading, tocLink);
            closeOutline(tocLink);
        }, 0);
    };

    syncOutlineMode();
});
