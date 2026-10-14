// ==UserScript==
// @name         B站视频播放位置记忆
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  为B站视频的每个分P单独记忆播放位置，并在再次打开时主动恢复
// @author       Gvxswur
// @match        https://www.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const LOG_PREFIX = '[B站视频播放位置记忆]';
    const STORAGE_PREFIX = 'bilibili-video-progress-v1:';
    const CLEANUP_MARKER_KEY = `${STORAGE_PREFIX}last-cleanup-at`;
    const STORAGE_VERSION = 1;
    const SAVE_INTERVAL_MS = 2000;
    const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
    const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const MIN_PROGRESS_SECONDS = 1;
    const COMPLETION_EPSILON_SECONDS = 0.5;
    const RESTORE_ATTEMPTS_MS = [0, 250, 750, 1500, 3000, 5000];
    const ROUTE_CHECK_INTERVAL_MS = 500;

    let activeSession = null;
    let initializeToken = 0;
    let initializeTimer = null;
    let lastRouteSignature = '';
    let mediaLoadVersion = 0;

    function normalizeVideoId(videoId) {
        if (/^bv/i.test(videoId)) {
            return `BV${videoId.slice(2)}`;
        }

        const aid = Number.parseInt(videoId.slice(2), 10);
        return `av${aid}`;
    }

    function parsePositiveInteger(value) {
        if (!/^\d+$/.test(value || '')) {
            return null;
        }

        const number = Number.parseInt(value, 10);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
    }

    function getCurrentRoute() {
        const url = new URL(location.href);
        const match = url.pathname.match(/^\/video\/((?:BV[0-9A-Za-z]+)|(?:av\d+))(?=\/|$)/i);
        if (!match) {
            return null;
        }

        const pageFromUrl = parsePositiveInteger(url.searchParams.get('p'));
        return {
            videoId: normalizeVideoId(match[1]),
            page: pageFromUrl || 1,
            hasExplicitPage: pageFromUrl !== null
        };
    }

    function getRouteSignature(route = getCurrentRoute()) {
        if (!route) {
            return '';
        }

        return `${route.videoId}|${route.hasExplicitPage ? `p:${route.page}` : 'bare'}`;
    }

    function getStorageKey(videoId) {
        return `${STORAGE_PREFIX}${videoId}`;
    }

    function createEmptyRecord() {
        return {
            version: STORAGE_VERSION,
            lastPage: 1,
            lastPageUpdatedAt: 0,
            parts: {}
        };
    }

    function readRecord(videoId) {
        try {
            const rawRecord = localStorage.getItem(getStorageKey(videoId));
            if (!rawRecord) {
                return createEmptyRecord();
            }

            const parsedRecord = JSON.parse(rawRecord);
            if (!parsedRecord
                || parsedRecord.version !== STORAGE_VERSION
                || !parsedRecord.parts
                || typeof parsedRecord.parts !== 'object'
                || Array.isArray(parsedRecord.parts)) {
                return createEmptyRecord();
            }

            parsedRecord.lastPage = parsePositiveInteger(String(parsedRecord.lastPage)) || 1;
            parsedRecord.lastPageUpdatedAt = Number(parsedRecord.lastPageUpdatedAt) || 0;
            return parsedRecord;
        } catch (error) {
            console.warn(`${LOG_PREFIX} 读取播放位置失败，将忽略损坏的记录`, error);
            return createEmptyRecord();
        }
    }

    function writeRecord(videoId, record) {
        try {
            localStorage.setItem(getStorageKey(videoId), JSON.stringify(record));
            return true;
        } catch (error) {
            console.error(`${LOG_PREFIX} 保存播放位置失败`, error);
            return false;
        }
    }

    function cleanupExpiredRecords() {
        const now = Date.now();

        try {
            const lastCleanupAt = Number(localStorage.getItem(CLEANUP_MARKER_KEY)) || 0;
            const timeSinceLastCleanup = now - lastCleanupAt;
            if (timeSinceLastCleanup >= 0 && timeSinceLastCleanup < CLEANUP_INTERVAL_MS) {
                return;
            }

            const cutoffTime = now - RETENTION_MS;
            const recordKeys = [];
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (key?.startsWith(STORAGE_PREFIX) && key !== CLEANUP_MARKER_KEY) {
                    recordKeys.push(key);
                }
            }

            let removedRecordCount = 0;
            let removedPartCount = 0;

            for (const key of recordKeys) {
                const rawRecord = localStorage.getItem(key);
                if (!rawRecord) {
                    continue;
                }

                let record;
                try {
                    record = JSON.parse(rawRecord);
                } catch (error) {
                    continue;
                }

                if (!record
                    || record.version !== STORAGE_VERSION
                    || !record.parts
                    || typeof record.parts !== 'object'
                    || Array.isArray(record.parts)) {
                    continue;
                }

                const lastPageUpdatedAt = Number(record.lastPageUpdatedAt) || 0;
                const latestActivityAt = Object.values(record.parts).reduce((latestTime, part) => {
                    return Math.max(latestTime, Number(part?.updatedAt) || 0);
                }, lastPageUpdatedAt);

                if (latestActivityAt > 0 && latestActivityAt < cutoffTime) {
                    localStorage.removeItem(key);
                    removedRecordCount += 1;
                    continue;
                }

                let recordChanged = false;
                for (const [page, part] of Object.entries(record.parts)) {
                    const partUpdatedAt = Number(part?.updatedAt) || lastPageUpdatedAt;
                    if (partUpdatedAt > 0 && partUpdatedAt < cutoffTime) {
                        delete record.parts[page];
                        removedPartCount += 1;
                        recordChanged = true;
                    }
                }

                if (recordChanged) {
                    localStorage.setItem(key, JSON.stringify(record));
                }
            }

            localStorage.setItem(CLEANUP_MARKER_KEY, String(now));
            if (removedRecordCount > 0 || removedPartCount > 0) {
                console.log(`${LOG_PREFIX} 已自动清理 ${removedRecordCount} 个过期视频记录、${removedPartCount} 个过期分P记录`);
            }
        } catch (error) {
            console.warn(`${LOG_PREFIX} 自动清理过期记录失败`, error);
        }
    }

    function getSavedPart(record, page, cid = null) {
        const savedPart = record.parts[String(page)];
        if (!savedPart || !Number.isFinite(Number(savedPart.time))) {
            return null;
        }

        if (cid && savedPart.cid && String(savedPart.cid) !== String(cid)) {
            return null;
        }

        const time = Number(savedPart.time);
        if (time < MIN_PROGRESS_SECONDS) {
            return null;
        }

        return {
            ...savedPart,
            time
        };
    }

    function updateLastPage(videoId, page) {
        const record = readRecord(videoId);
        record.lastPage = page;
        record.lastPageUpdatedAt = Date.now();
        writeRecord(videoId, record);
    }

    function clearPartProgress(videoId, page) {
        const record = readRecord(videoId);
        record.lastPage = page;
        record.lastPageUpdatedAt = Date.now();
        delete record.parts[String(page)];
        writeRecord(videoId, record);
    }

    function getInitialPartInfo(route, page) {
        const videoData = window.__INITIAL_STATE__?.videoData || window.__INITIAL_STATE__?.videoInfo;
        if (!videoData) {
            return null;
        }

        const stateBvid = typeof videoData.bvid === 'string' ? normalizeVideoId(videoData.bvid) : null;
        const stateAid = Number.isFinite(Number(videoData.aid)) ? `av${Number(videoData.aid)}` : null;
        if (route.videoId !== stateBvid && route.videoId !== stateAid) {
            return null;
        }

        const pages = Array.isArray(videoData.pages) ? videoData.pages : [];
        const part = pages.find((candidate) => Number(candidate.page) === page);
        if (!part) {
            return null;
        }

        return {
            cid: part.cid ? String(part.cid) : null,
            duration: Number(part.duration) || null
        };
    }

    function formatTimeForUrl(time) {
        return (Math.round(time * 10) / 10).toString();
    }

    function primeUrlForRestore(route, page, savedPart) {
        const url = new URL(location.href);

        if (!route.hasExplicitPage && page !== 1) {
            url.searchParams.set('p', String(page));
            if (savedPart) {
                url.searchParams.set('t', formatTimeForUrl(savedPart.time));
            } else {
                url.searchParams.delete('t');
            }

            console.log(`${LOG_PREFIX} 裸链接命中分P记录，跳转到 P${page}`);
            location.replace(url.href);
            return true;
        }

        if (savedPart) {
            const targetTime = formatTimeForUrl(savedPart.time);
            if (url.searchParams.get('t') !== targetTime) {
                url.searchParams.set('t', targetTime);
                try {
                    history.replaceState(history.state, '', url.href);
                } catch (error) {
                    console.warn(`${LOG_PREFIX} 无法预设播放时间参数，将由播放器就绪后恢复`, error);
                }
            }
        }

        return false;
    }

    function cleanupRestoreTimeParameter(session) {
        if (!session.restoreUrlTime) {
            return;
        }

        const url = new URL(location.href);
        if (url.searchParams.get('t') !== session.restoreUrlTime) {
            return;
        }

        url.searchParams.delete('t');
        try {
            history.replaceState(history.state, '', url.href);
        } catch (error) {
            console.warn(`${LOG_PREFIX} 无法清理临时播放时间参数`, error);
        }
    }

    function getVideoElement() {
        const preferredVideo = document.querySelector([
            '#bilibili-player video',
            '.bpx-player-container video',
            '.bilibili-player-video video'
        ].join(', '));

        if (preferredVideo) {
            return preferredVideo;
        }

        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length === 0) {
            return null;
        }

        return videos.sort((left, right) => {
            const leftArea = left.getBoundingClientRect().width * left.getBoundingClientRect().height;
            const rightArea = right.getBoundingClientRect().width * right.getBoundingClientRect().height;
            return rightArea - leftArea;
        })[0];
    }

    function waitForVideo(token, previousMedia = null) {
        return new Promise((resolve) => {
            const startedAt = Date.now();
            const intervalId = window.setInterval(() => {
                if (token !== initializeToken) {
                    window.clearInterval(intervalId);
                    resolve(null);
                    return;
                }

                const video = getVideoElement();
                const mediaHasChanged = !previousMedia
                    || video !== previousMedia.video
                    || video?.currentSrc !== previousMedia.currentSrc
                    || mediaLoadVersion !== previousMedia.loadVersion
                    || Date.now() - startedAt >= 1500;
                const mediaIsReady = !previousMedia
                    || video?.readyState > 0
                    || mediaLoadVersion !== previousMedia.loadVersion
                    || Date.now() - startedAt >= 1500;
                if (video && mediaHasChanged && mediaIsReady) {
                    window.clearInterval(intervalId);
                    resolve(video);
                    return;
                }

                if (Date.now() - startedAt >= 20000) {
                    window.clearInterval(intervalId);
                    resolve(null);
                }
            }, 200);
        });
    }

    function isSessionOnCurrentRoute(session) {
        const route = getCurrentRoute();
        if (!route || route.videoId !== session.videoId) {
            return false;
        }

        return (route.hasExplicitPage ? route.page : 1) === session.page;
    }

    function isVideoCompleted(video) {
        if (video.ended) {
            return true;
        }

        return Number.isFinite(video.duration)
            && video.duration > 0
            && video.currentTime >= video.duration - COMPLETION_EPSILON_SECONDS;
    }

    function saveSessionProgress(session, force = false) {
        if (!session || session.disposed || session.restoring || !isSessionOnCurrentRoute(session)) {
            return;
        }

        const now = Date.now();
        if (!force && now - session.lastSavedAt < SAVE_INTERVAL_MS) {
            return;
        }

        const video = session.video;
        if (isVideoCompleted(video)) {
            clearPartProgress(session.videoId, session.page);
            session.lastSavedAt = now;
            return;
        }

        const currentTime = Number(video.currentTime);
        if (!Number.isFinite(currentTime)) {
            return;
        }

        const record = readRecord(session.videoId);
        record.lastPage = session.page;
        record.lastPageUpdatedAt = now;

        if (currentTime < MIN_PROGRESS_SECONDS) {
            delete record.parts[String(session.page)];
        } else {
            record.parts[String(session.page)] = {
                time: Math.round(currentTime * 10) / 10,
                duration: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null,
                cid: session.cid,
                updatedAt: now
            };
        }

        if (writeRecord(session.videoId, record)) {
            session.lastSavedAt = now;
        }
    }

    function addSessionListener(session, target, type, handler, options = false) {
        target.addEventListener(type, handler, options);
        session.listeners.push({
            target,
            type,
            handler,
            capture: typeof options === 'boolean' ? options : Boolean(options.capture)
        });
    }

    function clearRestoreTimers(session) {
        session.restoreTimers.forEach((timerId) => window.clearTimeout(timerId));
        session.restoreTimers = [];
    }

    function finishRestoration(session) {
        if (!session || session.disposed || !session.restoring) {
            return;
        }

        session.restoring = false;
        clearRestoreTimers(session);
        cleanupRestoreTimeParameter(session);
        window.setTimeout(() => saveSessionProgress(session, true), 100);
    }

    function restoreProgress(session, savedPart) {
        const video = session.video;
        const savedTime = savedPart.time;
        session.restoring = true;
        session.restoreStartedAt = performance.now();

        const attemptRestore = (isLastAttempt) => {
            if (session.disposed || activeSession !== session || !isSessionOnCurrentRoute(session)) {
                return;
            }

            const duration = Number(video.duration);
            if (Number.isFinite(duration) && duration > 0 && savedTime >= duration - COMPLETION_EPSILON_SECONDS) {
                clearPartProgress(session.videoId, session.page);
                finishRestoration(session);
                return;
            }

            if (video.readyState > 0) {
                const targetTime = Number.isFinite(duration) && duration > 0
                    ? Math.min(savedTime, Math.max(0, duration - COMPLETION_EPSILON_SECONDS))
                    : savedTime;
                const elapsedSeconds = (performance.now() - session.restoreStartedAt) / 1000;
                const toleratedNaturalProgress = 3 + elapsedSeconds * Math.max(1, Number(video.playbackRate) || 1);

                const difference = Math.abs(video.currentTime - targetTime);
                if (!session.restoreApplied || difference > toleratedNaturalProgress) {
                    try {
                        if (difference > 0.25) {
                            video.currentTime = targetTime;
                        }
                        session.restoreApplied = true;
                    } catch (error) {
                        console.warn(`${LOG_PREFIX} 播放器暂时无法跳转，稍后重试`, error);
                    }
                }

                if (!session.restoreLogged) {
                    session.restoreLogged = true;
                    console.log(`${LOG_PREFIX} 已恢复 ${session.videoId} P${session.page} 到 ${targetTime.toFixed(1)} 秒`);
                }
            }

            if (isLastAttempt) {
                finishRestoration(session);
            }
        };

        RESTORE_ATTEMPTS_MS.forEach((delay, index) => {
            const timerId = window.setTimeout(() => {
                attemptRestore(index === RESTORE_ATTEMPTS_MS.length - 1);
            }, delay);
            session.restoreTimers.push(timerId);
        });
    }

    function isPlayerInteraction(event) {
        if (event.type === 'keydown') {
            return ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'j', 'J', 'l', 'L'].includes(event.key)
                || /^\d$/.test(event.key);
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return false;
        }

        return Boolean(target.closest([
            '.bpx-player-progress-wrap',
            '.bpx-player-progress',
            '.bilibili-player-video-progress'
        ].join(', ')));
    }

    function bindSession(session, savedPart) {
        const video = session.video;

        addSessionListener(session, video, 'timeupdate', () => saveSessionProgress(session));
        addSessionListener(session, video, 'pause', () => saveSessionProgress(session, true));
        addSessionListener(session, video, 'seeked', () => saveSessionProgress(session, true));
        addSessionListener(session, video, 'ended', () => {
            session.restoring = false;
            clearRestoreTimers(session);
            clearPartProgress(session.videoId, session.page);
            cleanupRestoreTimeParameter(session);
            console.log(`${LOG_PREFIX} ${session.videoId} P${session.page} 已播放完成，已清除该P的播放位置`);
        });

        addSessionListener(session, document, 'visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                saveSessionProgress(session, true);
            }
        });
        addSessionListener(session, window, 'pagehide', () => saveSessionProgress(session, true));

        const cancelRestoreOnInteraction = (event) => {
            if (session.restoring && isPlayerInteraction(event)) {
                finishRestoration(session);
            }
        };
        addSessionListener(session, document, 'pointerdown', cancelRestoreOnInteraction, true);
        addSessionListener(session, document, 'keydown', cancelRestoreOnInteraction, true);

        if (savedPart) {
            restoreProgress(session, savedPart);
        }
    }

    function disposeActiveSession(shouldSave = true) {
        const session = activeSession;
        if (!session) {
            return;
        }

        if (shouldSave) {
            saveSessionProgress(session, true);
        }

        session.disposed = true;
        clearRestoreTimers(session);
        session.listeners.forEach(({target, type, handler, capture}) => {
            target.removeEventListener(type, handler, capture);
        });
        session.listeners = [];
        activeSession = null;
    }

    async function initializeForCurrentRoute(reason, previousMedia = null) {
        const token = ++initializeToken;
        disposeActiveSession(true);

        const route = getCurrentRoute();
        if (!route) {
            return;
        }

        const initialRecord = readRecord(route.videoId);
        const page = route.hasExplicitPage ? route.page : initialRecord.lastPage;
        const initialPartInfo = getInitialPartInfo(route, page);
        const initialSavedPart = getSavedPart(initialRecord, page, initialPartInfo?.cid || null);

        if (primeUrlForRestore(route, page, initialSavedPart)) {
            return;
        }

        updateLastPage(route.videoId, page);
        const video = await waitForVideo(token, previousMedia);
        if (!video || token !== initializeToken || getRouteSignature() !== getRouteSignature(route)) {
            if (!video && token === initializeToken) {
                console.warn(`${LOG_PREFIX} 等待播放器超时`);
            }
            return;
        }

        const partInfo = getInitialPartInfo(route, page);
        const latestRecord = readRecord(route.videoId);
        const savedPart = getSavedPart(latestRecord, page, partInfo?.cid || null);

        if (!savedPart && latestRecord.parts[String(page)] && partInfo?.cid) {
            clearPartProgress(route.videoId, page);
        }

        const session = {
            video,
            videoId: route.videoId,
            page,
            cid: partInfo?.cid || null,
            lastSavedAt: 0,
            restoring: false,
            restoreApplied: false,
            restoreLogged: false,
            restoreStartedAt: 0,
            restoreUrlTime: savedPart ? formatTimeForUrl(savedPart.time) : null,
            restoreTimers: [],
            listeners: [],
            disposed: false
        };

        activeSession = session;
        bindSession(session, savedPart);
        console.log(`${LOG_PREFIX} 已监听 ${route.videoId} P${page}，触发原因: ${reason}`);
    }

    function captureActiveMedia() {
        if (!activeSession) {
            return null;
        }

        return {
            video: activeSession.video,
            currentSrc: activeSession.video.currentSrc,
            loadVersion: mediaLoadVersion
        };
    }

    function scheduleInitialization(reason, delay = 350, previousMedia = null) {
        if (initializeTimer !== null) {
            window.clearTimeout(initializeTimer);
        }

        initializeTimer = window.setTimeout(() => {
            initializeTimer = null;
            initializeForCurrentRoute(reason, previousMedia);
        }, delay);
    }

    function checkForRouteChange(reason) {
        const route = getCurrentRoute();
        const currentSignature = getRouteSignature(route);
        if (currentSignature === lastRouteSignature) {
            return;
        }

        const previousMedia = captureActiveMedia();
        lastRouteSignature = currentSignature;

        if (route && !route.hasExplicitPage) {
            const record = readRecord(route.videoId);
            const page = record.lastPage;
            if (page !== 1) {
                const partInfo = getInitialPartInfo(route, page);
                const savedPart = getSavedPart(record, page, partInfo?.cid || null);
                if (primeUrlForRestore(route, page, savedPart)) {
                    return;
                }
            }
        }

        scheduleInitialization(reason, 350, previousMedia);
    }

    function installNavigationWatcher() {
        document.addEventListener('loadedmetadata', (event) => {
            if (event.target instanceof HTMLMediaElement) {
                mediaLoadVersion += 1;
            }
        }, true);

        for (const methodName of ['pushState', 'replaceState']) {
            const originalMethod = history[methodName];
            history[methodName] = function(...args) {
                if (activeSession) {
                    saveSessionProgress(activeSession, true);
                }

                const result = Reflect.apply(originalMethod, this, args);
                checkForRouteChange(`history.${methodName}`);
                return result;
            };
        }

        window.addEventListener('popstate', () => checkForRouteChange('popstate'), true);
        window.addEventListener('hashchange', () => checkForRouteChange('hashchange'), true);

        window.setInterval(() => {
            checkForRouteChange('url-polling');

            if (activeSession) {
                const currentVideo = getVideoElement();
                if (currentVideo && currentVideo !== activeSession.video) {
                    scheduleInitialization('video-element-replaced', 100, captureActiveMedia());
                }
            }
        }, ROUTE_CHECK_INTERVAL_MS);
    }

    lastRouteSignature = getRouteSignature();
    cleanupExpiredRecords();
    window.setInterval(cleanupExpiredRecords, CLEANUP_INTERVAL_MS);
    installNavigationWatcher();
    initializeForCurrentRoute('startup');
})();
