/* =============================================================
   academy.js — FPV Academy Interactions
   Standalone IIFE. No external dependencies.
   Handles: topic card clicks, back-to-top button, smooth scroll.
   ============================================================= */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', initAcademy);

    function initAcademy() {
        setupTopicCardClicks();
        setupBackToTop();
        setupStartLearning();
    }

    /**
     * Topic card clicks — scroll to and open the corresponding article section.
     */
    function setupTopicCardClicks() {
        const cards = document.querySelectorAll('.acad-topic-card[data-target]');
        cards.forEach(function (card) {
            card.addEventListener('click', function () {
                const targetId = card.getAttribute('data-target');
                const target = document.getElementById(targetId);
                if (!target) return;

                // Open the details element if closed
                if (!target.open) {
                    target.open = true;
                }

                // Smooth scroll to the section
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    /**
     * Back-to-top button — show after scrolling past topic cards, scroll to top on click.
     */
    function setupBackToTop() {
        var btn = document.getElementById('acad-back-to-top');
        var contentBody = document.getElementById('acad-content-body');
        if (!btn || !contentBody) return;

        contentBody.addEventListener('scroll', function () {
            if (contentBody.scrollTop > 400) {
                btn.classList.add('acad-visible');
            } else {
                btn.classList.remove('acad-visible');
            }
        });

        btn.addEventListener('click', function () {
            contentBody.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    /**
     * "Start Learning" hero CTA — smooth scroll to topics grid.
     */
    function setupStartLearning() {
        var cta = document.getElementById('acad-start-learning');
        if (!cta) return;

        cta.addEventListener('click', function (e) {
            e.preventDefault();
            var target = document.getElementById('acad-topics');
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }
})();
