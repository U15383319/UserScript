// ==UserScript==
// @name         禁用B站快捷键
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  禁用B站网页端的快捷键
// @author       Gvxswur
// @match        *://www.bilibili.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    document.addEventListener('keydown', function(e) {
        const allowedKeys = [' ', 'ArrowLeft', 'ArrowRight']
        if (!allowedKeys.includes(e.key)) {
            // 禁用快捷键
            e.stopPropagation();
        } else {
            // 解决和图片浏览的冲突
            if (e.key.startsWith('Arrow')) {
                if (document.querySelector('.bpx-docker-viewer-wrap, .image-viewer, .gallery-container') !== null) {
                    e.stopPropagation();
                }
            }
        }
    }, true);
})();
