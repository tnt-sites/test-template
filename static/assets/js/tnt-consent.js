/**
 * TNT Cookie Consent Manager
 * 
 * A lightweight, dependency-free cookie consent manager for TNT Dental websites.
 * Handles consent banner display, preference storage, and conditional script loading.
 * 
 * @version 1.0.0
 */

(function () {
    'use strict';

    // Configuration
    var CONSENT_COOKIE = 'tnt_consent_v1';
    var COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

    /**
     * Read consent preferences from cookie
     * @returns {Object|null} Parsed preferences object or null if not found/invalid
     */
    function readConsent() {
        if (!document.cookie) {
            return null;
        }

        var cookies = document.cookie.split(';');
        var consentCookie = null;

        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            if (cookie.indexOf(CONSENT_COOKIE + '=') === 0) {
                consentCookie = cookie.substring(CONSENT_COOKIE.length + 1);
                break;
            }
        }

        if (!consentCookie) {
            return null;
        }

        try {
            // URL decode and parse JSON
            var decoded = decodeURIComponent(consentCookie);
            var prefs = JSON.parse(decoded);

            // Validate structure
            if (typeof prefs === 'object' && prefs !== null) {
                return prefs;
            }
        } catch (e) {
            // Invalid cookie, return null
            return null;
        }

        return null;
    }

    /**
     * Write consent preferences to cookie
     * @param {Object} prefs - Preferences object with analytics, advertising, other properties
     */
    function writeConsent(prefs) {
        try {
            var json = JSON.stringify(prefs);
            var encoded = encodeURIComponent(json);
            var expires = new Date();
            expires.setTime(expires.getTime() + (COOKIE_MAX_AGE * 1000));

            var cookieValue = CONSENT_COOKIE + '=' + encoded +
                ';path=/' +
                ';max-age=' + COOKIE_MAX_AGE +
                ';SameSite=Lax';

            document.cookie = cookieValue;
        } catch (e) {
            // Silently fail if cookie write fails
            console.warn('TNT Consent: Failed to write cookie', e);
        }
    }

    /**
     * Load scripts for allowed categories
     * @param {Object} prefs - Preferences object
     */
    function loadScriptsFor(prefs) {
        if (!prefs || typeof prefs !== 'object') {
            return;
        }

        // Find all script tags with type="text/plain" and data-tnt-category
        var scripts = document.querySelectorAll('script[type="text/plain"][data-tnt-category]');

        for (var i = 0; i < scripts.length; i++) {
            var script = scripts[i];
            var category = script.getAttribute('data-tnt-category');

            // Skip if category is not allowed
            if (!prefs[category]) {
                continue;
            }

            // Create new script element
            var newScript = document.createElement('script');

            // Copy attributes
            var src = script.getAttribute('data-src');
            if (src) {
                newScript.src = src;
            }

            // Handle async/defer attributes
            if (script.getAttribute('data-async') === 'true') {
                newScript.async = true;
            }
            if (script.getAttribute('data-defer') === 'true') {
                newScript.defer = true;
            }

            // Copy other data-* attributes that might be needed (except tnt-category and data-src)
            var attrs = script.attributes;
            for (var j = 0; j < attrs.length; j++) {
                var attr = attrs[j];
                if (attr.name.indexOf('data-') === 0 &&
                    attr.name !== 'data-tnt-category' &&
                    attr.name !== 'data-src' &&
                    attr.name !== 'data-async' &&
                    attr.name !== 'data-defer') {
                    newScript.setAttribute(attr.name, attr.value);
                }
            }

            // If inline script (no data-src), copy the text content
            if (!src && script.textContent) {
                newScript.textContent = script.textContent;
            }

            // Insert before the old script and remove the old one
            script.parentNode.insertBefore(newScript, script);
            script.parentNode.removeChild(script);
        }
    }

    /**
     * Build and display the consent banner
     * @param {Function} onSave - Callback function called when user saves preferences
     * @param {Object|null} existingPrefs - Optional existing preferences to pre-check
     */
    function buildBanner(onSave, existingPrefs) {
        // Prevent duplicate banners
        if (document.getElementById('tnt-cookie-banner')) {
            return;
        }

        // Ensure body exists
        if (!document.body) {
            return;
        }

        // Determine checkbox states (default to checked if no existing preferences)
        var analyticsChecked = existingPrefs ? (existingPrefs.analytics === true) : true;
        var adsChecked = existingPrefs ? (existingPrefs.advertising === true) : true;
        var otherChecked = existingPrefs ? (existingPrefs.other === true) : true;

        var banner = document.createElement('div');
        banner.id = 'tnt-cookie-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Cookie consent');

        banner.innerHTML = '' +
            '<div class="tnt-cookie-inner">' +
            '<p>We use cookies to run this website and to analyze and improve performance. ' +
            'You can opt out of analytics, advertising, and other tracking.</p>' +
            '<div class="tnt-cookie-options">' +
            '<label><input type="checkbox" id="tnt-consent-analytics" ' + (analyticsChecked ? 'checked' : '') + '> Analytics</label>' +
            '<label><input type="checkbox" id="tnt-consent-ads" ' + (adsChecked ? 'checked' : '') + '> Advertising</label>' +
            '<label><input type="checkbox" id="tnt-consent-other" ' + (otherChecked ? 'checked' : '') + '> Other tracking</label>' +
            '</div>' +
            '<div class="tnt-cookie-buttons">' +
            '<button id="tnt-consent-accept-all" type="button">Accept all</button>' +
            '<button id="tnt-consent-save" type="button">Save choices</button>' +
            '<button id="tnt-consent-reject" type="button">Reject non-essential</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(banner);

        // Accept all button
        var acceptAllBtn = document.getElementById('tnt-consent-accept-all');
        if (acceptAllBtn) {
            acceptAllBtn.onclick = function () {
                onSave({
                    analytics: true,
                    advertising: true,
                    other: true
                });
                banner.remove();
            };
        }

        // Reject non-essential button
        var rejectBtn = document.getElementById('tnt-consent-reject');
        if (rejectBtn) {
            rejectBtn.onclick = function () {
                onSave({
                    analytics: false,
                    advertising: false,
                    other: false
                });
                banner.remove();
            };
        }

        // Save choices button
        var saveBtn = document.getElementById('tnt-consent-save');
        if (saveBtn) {
            saveBtn.onclick = function () {
                var prefs = {
                    analytics: document.getElementById('tnt-consent-analytics').checked,
                    advertising: document.getElementById('tnt-consent-ads').checked,
                    other: document.getElementById('tnt-consent-other').checked
                };
                onSave(prefs);
                banner.remove();
            };
        }
    }

    /**
     * Initialize the consent manager
     */
    function init() {
        var prefs = readConsent();

        if (prefs) {
            // User has already consented, load scripts immediately
            loadScriptsFor(prefs);
        } else {
            // No consent yet, show banner after DOM is ready
            var ready = function () {
                buildBanner(function (p) {
                    writeConsent(p);
                    loadScriptsFor(p);
                });
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', ready);
            } else {
                // DOM already ready
                ready();
            }
        }
    }

    // Public API
    window.TNTConsent = {
        /**
         * Read current consent preferences
         * @returns {Object|null} Current preferences or null if not set
         */
        read: readConsent
    };

    /**
     * Reset consent and show banner again
     * Useful for "Cookie preferences" links
     * Reads existing preferences and pre-checks them in the banner
     */
    window.TNTConsentReset = function () {
        // Read existing preferences before clearing
        var existingPrefs = readConsent();

        // Remove any existing banner
        var existingBanner = document.getElementById('tnt-cookie-banner');
        if (existingBanner) {
            existingBanner.remove();
        }

        // Show banner again with existing preferences pre-selected
        var ready = function () {
            buildBanner(function (p) {
                writeConsent(p);
                loadScriptsFor(p);
            }, existingPrefs); // Pass existing preferences to pre-check
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ready);
        } else {
            ready();
        }
    };

    // Initialize on load
    init();
})();
