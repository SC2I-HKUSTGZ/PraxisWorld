(function () {
    const buttons = Array.from(document.querySelectorAll('.chapters button[data-section]'));
    const sections = buttons
        .map((button) => document.getElementById(button.dataset.section))
        .filter(Boolean);

    function selectButton(id) {
        buttons.forEach((button) => {
            button.classList.toggle('selected', button.dataset.section === id);
        });
    }

    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            const section = document.getElementById(button.dataset.section);
            if (!section) return;
            selectButton(button.dataset.section);
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (visible) selectButton(visible.target.id);
        }, {
            rootMargin: '-25% 0px -55% 0px',
            threshold: [0.1, 0.25, 0.5, 0.75]
        });
        sections.forEach((section) => observer.observe(section));
    }

    const copyButton = document.querySelector('[data-copy-target="bibtex"]');
    const bibtex = document.getElementById('bibtex');
    if (copyButton && bibtex) {
        copyButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(bibtex.textContent.trim());
                const original = copyButton.textContent;
                copyButton.textContent = 'Copied';
                window.setTimeout(() => {
                    copyButton.textContent = original;
                }, 1400);
            } catch (error) {
                copyButton.textContent = 'Copy failed';
                window.setTimeout(() => {
                    copyButton.textContent = 'Copy BibTeX';
                }, 1400);
            }
        });
    }
}());
