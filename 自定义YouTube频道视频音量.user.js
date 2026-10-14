// ==UserScript==
// @name         自定义YouTube频道视频音量
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  为不同 YouTube 频道的视频单独保存音量设置
// @author       Gvxswur
// @match        https://www.youtube.com/watch*
// @icon         https://www.youtube.com/favicon.ico
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULT_VOLUME = 0.04;
    const STORAGE_PREFIX = 'youtube-channel-volume-';
    const LOG_PREFIX = '[自定义YouTube频道视频音量]';
    const SUPPORTED_PATHNAME = '/watch';

    let currentVideo = null;
    let currentChannelId = null;
    let currentVolumeChangeHandler = null;
    let currentUrl = location.href;
    let navigationToken = 0;
    let suppressVolumeSave = false;

    function isSupportedPage() {
        return location.pathname === SUPPORTED_PATHNAME;
    }

    function clampVolume(volume) {
        return Math.min(1, Math.max(0, volume));
    }

    function getSavedVolume(channelId) {
        const savedVolume = parseFloat(localStorage.getItem(`${STORAGE_PREFIX}${channelId}`));
        return Number.isFinite(savedVolume) ? clampVolume(savedVolume) : DEFAULT_VOLUME;
    }

    function saveVolume(channelId, volume) {
        const normalizedVolume = clampVolume(volume);
        localStorage.setItem(`${STORAGE_PREFIX}${channelId}`, normalizedVolume.toString());
        console.log(`${LOG_PREFIX} 已保存频道 ${channelId} 的音量设置: ${Math.round(normalizedVolume * 100)}%`);
    }

    function clearVolume(channelId) {
        localStorage.removeItem(`${STORAGE_PREFIX}${channelId}`);
        console.log(`${LOG_PREFIX} 已清除频道 ${channelId} 的音量设置`);
    }

    function getVideoElement() {
        const videos = document.querySelectorAll('video');
        return Array.from(videos).find((video) => video.closest('#movie_player, ytd-player, ytd-watch-flexy')) || videos[0] || null;
    }

    function parseChannelIdentifierFromHref(href) {
        if (!href) {
            return null;
        }

        const normalizedHref = href.replace(/^https?:\/\/www\.youtube\.com/i, '');
        const channelMatch = normalizedHref.match(/\/channel\/([^/?#]+)/);
        if (channelMatch) {
            return channelMatch[1];
        }

        const handleMatch = normalizedHref.match(/\/(@[^/?#]+)/);
        if (handleMatch) {
            return handleMatch[1];
        }

        return null;
    }

    function getChannelId() {
        const candidateIds = [
            window.ytInitialPlayerResponse?.videoDetails?.channelId,
            document.querySelector('ytd-watch-flexy')?.data?.playerResponse?.videoDetails?.channelId,
            document.querySelector('ytd-watch-flexy')?.playerData?.videoDetails?.channelId,
            document.querySelector('ytd-watch-metadata')?.data?.owner?.videoOwnerRenderer?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId,
            document.querySelector('ytd-video-owner-renderer')?.data?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
        ];

        const firstValidCandidate = candidateIds.find((candidate) => typeof candidate === 'string' && candidate.trim() !== '');
        if (firstValidCandidate) {
            return firstValidCandidate;
        }

        const channelLinkSelectors = [
            'ytd-watch-metadata ytd-channel-name a',
            '#owner #channel-name a',
            'ytd-video-owner-renderer a'
        ];

        for (const selector of channelLinkSelectors) {
            const href = document.querySelector(selector)?.getAttribute('href');
            const channelIdentifier = parseChannelIdentifierFromHref(href);
            if (channelIdentifier) {
                return channelIdentifier;
            }
        }

        return null;
    }

    function cleanupVolumeListener() {
        if (currentVideo && currentVolumeChangeHandler) {
            currentVideo.removeEventListener('volumechange', currentVolumeChangeHandler);
        }

        currentVideo = null;
        currentChannelId = null;
        currentVolumeChangeHandler = null;
    }

    function setVideoVolume(video, volume) {
        if (!video) {
            return false;
        }

        suppressVolumeSave = true;
        video.volume = clampVolume(volume);

        window.setTimeout(() => {
            suppressVolumeSave = false;
        }, 0);

        console.log(`${LOG_PREFIX} 视频音量设置为 ${Math.round(video.volume * 100)}%`);
        return true;
    }

    function monitorVolumeChange(channelId, video) {
        cleanupVolumeListener();

        currentVideo = video;
        currentChannelId = channelId;
        currentVolumeChangeHandler = () => {
            if (suppressVolumeSave || currentVideo !== video || !isSupportedPage()) {
                return;
            }

            const currentVolumeValue = clampVolume(video.volume);
            if (Math.abs(currentVolumeValue - DEFAULT_VOLUME) > 0.01) {
                saveVolume(channelId, currentVolumeValue);
            } else {
                clearVolume(channelId);
            }
        };

        video.addEventListener('volumechange', currentVolumeChangeHandler);
        console.log(`${LOG_PREFIX} 已开始监听频道 ${channelId} 的音量变化`);
    }

    function applyVolumeSettings(channelId) {
        const savedVolume = getSavedVolume(channelId);
        let attempts = 0;
        const maxAttempts = 20;

        const intervalId = window.setInterval(() => {
            attempts += 1;

            if (!isSupportedPage()) {
                window.clearInterval(intervalId);
                return;
            }

            const video = getVideoElement();
            if (!video) {
                if (attempts >= maxAttempts) {
                    window.clearInterval(intervalId);
                    console.error(`${LOG_PREFIX} 无法找到视频元素`);
                }
                return;
            }

            setVideoVolume(video, savedVolume);

            if (Math.abs(video.volume - savedVolume) <= 0.01 || attempts >= maxAttempts) {
                window.clearInterval(intervalId);
                console.log(`${LOG_PREFIX} 已为频道 ${channelId} 应用音量设置`);
            }
        }, 300);
    }

    function initializeScript(reason = 'startup') {
        if (!isSupportedPage()) {
            cleanupVolumeListener();
            return;
        }

        const token = ++navigationToken;
        let attempts = 0;
        const maxAttempts = 40;

        console.log(`${LOG_PREFIX} 初始化脚本，触发原因: ${reason}`);

        const intervalId = window.setInterval(() => {
            attempts += 1;

            if (token !== navigationToken) {
                window.clearInterval(intervalId);
                return;
            }

            const channelId = getChannelId();
            const video = getVideoElement();

            if (channelId && video) {
                window.clearInterval(intervalId);
                console.log(`${LOG_PREFIX} 当前频道标识: ${channelId}`);
                monitorVolumeChange(channelId, video);
                applyVolumeSettings(channelId);
                return;
            }

            if (attempts >= maxAttempts) {
                window.clearInterval(intervalId);
                console.error(`${LOG_PREFIX} 无法完成初始化，频道或视频元素未就绪`);
            }
        }, 500);
    }

    function handlePotentialNavigation(reason) {
        if (location.href === currentUrl) {
            return;
        }

        currentUrl = location.href;
        console.log(`${LOG_PREFIX} 检测到页面切换: ${currentUrl}`);
        window.setTimeout(() => initializeScript(reason), 600);
    }

    function observePageChanges() {
        document.addEventListener('yt-navigate-finish', () => {
            handlePotentialNavigation('yt-navigate-finish');
        }, true);

        window.addEventListener('popstate', () => {
            handlePotentialNavigation('popstate');
        }, true);

        window.setInterval(() => {
            handlePotentialNavigation('url-polling');

            if (!isSupportedPage() || !currentChannelId) {
                return;
            }

            const activeVideo = getVideoElement();
            if (activeVideo && activeVideo !== currentVideo) {
                console.log(`${LOG_PREFIX} 检测到视频元素替换，重新绑定监听`);
                monitorVolumeChange(currentChannelId, activeVideo);
                applyVolumeSettings(currentChannelId);
            }
        }, 1000);
    }

    initializeScript();
    observePageChanges();
})();
