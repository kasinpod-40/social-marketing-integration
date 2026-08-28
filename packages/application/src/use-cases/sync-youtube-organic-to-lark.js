import {
  mapMissingYouTubeVideoRawRow,
  mapYouTubeAnalyticsResponse,
  mapYouTubeChannelRawRow,
  mapYouTubeVideoRawRow,
  validateYouTubeAnalyticsRowsScope,
} from '../../../connectors/src/youtube/youtube-raw.adapter.js';
import { mapYouTubeChannelResource } from '../../../connectors/src/youtube/youtube-organic.adapter.js';
import { normalizeYouTubeVideoBatch } from './normalize-youtube-video-batch.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { createContentKey } from '../storage/marketing-history-contract.js';

const ANALYTICS_METRICS = 'views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage';
const ANALYTICS_DIMENSIONS = 'day,video';
const ANALYTICS_SORT = 'day,video';
const VIDEO_BATCH_SIZE = 50;
const ANALYTICS_PAGE_SIZE = 200;
const WORK_UNIT_READ_LIMIT = 100;
const WORK_UNIT_MAX_PAGES = 10_000;
const WORK_PHASES = Object.freeze({
  CONTENT_INVENTORY: 'youtube_content_inventory',
  CONTENT_RESOURCES: 'youtube_content_resources',
  ANALYTICS: 'youtube_owner_analytics',
  D1_STORAGE: 'youtube_d1_storage_v1',
  DESTINATION_CONTENT: 'youtube_destination_content_v1',
  DESTINATION_DAILY: 'youtube_destination_daily_v1',
  DESTINATION_ACCOUNTS: 'youtube_destination_accounts_v1',
});

/** YouTube Organic sync: RAW → Canonical → Account activation row → D1 checkpoint */
export async function syncYouTubeOrganicToLark(input = {}) {
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const publicClient = requireYouTubeClient(input.publicClient, 'publicClient');
  const ownerClient = input.ownerClient ?? null;
  const stateStore = requireStateStore(input.incrementalStateStore);
  const workStore = requireWorkStore(input.resumableWorkStore);
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const decorateCompletion = typeof input.decorateCompletion === 'function'
    ? input.decorateCompletion
    : async (completion) => completion;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const fetchedAt = safeTimestamp(now());
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const channelId = requireText(input.channelId, 'channelId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');
  const workKey = requireText(input.workKey ?? syncRunId, 'workKey');
  const requestedAt = safeTimestamp(input.requestedAt ?? input.generation ?? fetchedAt);
  const generation = safeTimestamp(input.generation ?? requestedAt);
  const syncType = requireText(input.syncType ?? 'organic_sync', 'syncType');
  const metricDate = requireDateOnly(input.metricDate, { label: 'metricDate' });
  const tables = requireTables(input.tables);
  const historyGateway = input.historyGateway ?? null;
  const analyticsStore = input.analyticsStore ?? null;
  const analyticsEnabled = input.analyticsEnabled === true;
  const analyticsRange = analyticsEnabled
    ? Object.freeze({
      startDate: requireDateOnly(input.analyticsStartDate, { label: 'analyticsStartDate' }),
      endDate: requireDateOnly(input.analyticsEndDate, { label: 'analyticsEndDate' }),
    })
    : null;
  const sourceUnitBudget = createSourceUnitBudget(input.maxSourceUnitsPerInvocation);
  const maxDestinationRowsPerInvocation = readOptionalPositiveInteger(
    input.maxDestinationRowsPerInvocation,
    'maxDestinationRowsPerInvocation',
  );
  const maxStorageRowsPerInvocation = maxDestinationRowsPerInvocation === null
    ? null
    : positiveInteger(
      input.maxStorageRowsPerInvocation ?? maxDestinationRowsPerInvocation,
      'maxStorageRowsPerInvocation',
    );

  onProgress({ stage: 'youtube_checkpoint_loading', cursorKey });
  const checkpoint = await stateStore.loadCheckpoint(cursorKey);
  const priorStates = Array.isArray(checkpoint?.recordStates) ? checkpoint.recordStates : [];
  const syncMode = decideSyncMode({
    requested: input.syncMode,
    checkpoint,
    now: fetchedAt,
    fullSyncIntervalMs: positiveInteger(input.fullSyncIntervalMs ?? 86_400_000, 'fullSyncIntervalMs'),
  });

  const recentVideoLimit = positiveInteger(input.recentVideoLimit ?? 100, 'recentVideoLimit');
  const contentMaxPages = positiveInteger(input.contentMaxPages ?? 100, 'contentMaxPages');
  const operationFingerprint = await createStableFingerprint({
    contract: 'youtube-organic-resumable-v1',
    channelId,
    metricDate,
    syncMode: syncMode.mode,
    fullSnapshot: syncMode.fullSnapshot,
    recentVideoLimit,
    analyticsRange,
  });
  const work = await workStore.beginWork({
    workKey,
    cursorKey,
    workType: 'youtube_organic_sync',
    operationFingerprint,
    generation,
    requestedAt,
  });
  if (work.superseded) return supersededResult({ syncRunId, generation });
  if (work.completed) {
    return replayCompletedWork({
      workStore,
      workKey,
      syncRunId,
      completion: work.completion,
    });
  }
  const assertCurrentWork = async () => {
    await assertLockActive();
    await workStore.assertCurrentGeneration({ workKey, cursorKey, generation });
  };
  await assertCurrentWork();

  const channelResource = await publicClient.getChannel({ channelId });
  const channel = mapYouTubeChannelResource(channelResource, channelId);
  if (analyticsEnabled) {
    await assertCurrentWork();
    await assertOwnerChannel({ ownerClient, channelId });
  }
  const inventory = await loadUploadInventory({
    workStore,
    workKey,
    publicClient,
    uploadsPlaylistId: channel.uploadsPlaylistId,
    maxItems: syncMode.fullSnapshot ? null : recentVideoLimit,
    maxPages: contentMaxPages,
    assertLockActive: assertCurrentWork,
    onProgress,
    sourceUnitBudget,
  });
  if (!inventory.complete) {
    return buildContinuationResult({
      syncRunId,
      workResumed: work.resumed,
      continuationPhase: WORK_PHASES.CONTENT_INVENTORY,
      sourceProgress: inventory,
    });
  }
  const videoIds = inventory.videoIds;
  const existingAnalyticsPhase = analyticsRange
    ? await workStore.loadPhase({ workKey, phase: WORK_PHASES.ANALYTICS })
    : null;
  if (existingAnalyticsPhase && !existingAnalyticsPhase.complete) {
    const trackedVideoIds = resolveTrackedAnalyticsVideoIds({
      priorStates,
      currentVideoIds: videoIds,
    });
    const analyticsProgress = await loadAnalyticsRows({
      workStore,
      workKey,
      ownerClient,
      channelId,
      videoIds: trackedVideoIds,
      startDate: analyticsRange.startDate,
      endDate: analyticsRange.endDate,
      fetchedAt,
      assertLockActive: assertCurrentWork,
      maxPages: positiveInteger(input.analyticsMaxPages ?? 1000, 'analyticsMaxPages'),
      onProgress,
      sourceUnitBudget,
      deferCompletedRead: true,
    });
    return buildContinuationResult({
      syncRunId,
      workResumed: work.resumed,
      continuationPhase: WORK_PHASES.ANALYTICS,
      sourceProgress: analyticsProgress,
    });
  }
  const existingStoragePhase = maxStorageRowsPerInvocation === null
    ? null
    : await workStore.loadPhase({ workKey, phase: WORK_PHASES.D1_STORAGE });
  if (existingStoragePhase && !existingStoragePhase.complete) {
    const storageContinuation = await continueExistingYouTubeStoragePhase({
      repository,
      syncEngine,
      workStore,
      workKey,
      existingStoragePhase,
      videoIds,
      channelResource,
      channelId,
      accountKey,
      customerProfile,
      metricDate,
      reportingTimezone: input.reportingTimezone,
      maxRows: maxStorageRowsPerInvocation,
      dictionaryRules: input.dictionaryRules,
      fetchedAt,
      assertCurrentWork,
    });
    if (storageContinuation) {
      return buildContinuationResult({
        syncRunId,
        workResumed: work.resumed,
        continuationPhase: WORK_PHASES.D1_STORAGE,
        sourceProgress: storageContinuation,
      });
    }
  }
  if (maxDestinationRowsPerInvocation !== null && existingStoragePhase?.complete) {
    // The exact-range destination path bypasses executeDurableDestinationPhases(), which normally
    // restores the already-complete D1-first result. Restore it here as well so executePlan() does
    // not attempt a fresh full storage capture from a one-row destination continuation.
    if (typeof syncEngine.resumeStorage === 'function') {
      syncEngine.resumeStorage(existingStoragePhase.state?.storage);
    }
    const destinationContinuation = await continueExistingYouTubeDestinationPhase({
      repository,
      syncEngine,
      workStore,
      workKey,
      videoIds,
      channel,
      channelId,
      accountKey,
      metricDate,
      reportingTimezone: input.reportingTimezone,
      maxRows: maxDestinationRowsPerInvocation,
      dictionaryRules: input.dictionaryRules,
      tables,
      fetchedAt,
      onProgress,
      assertCurrentWork,
    });
    if (destinationContinuation) {
      return buildContinuationResult({
        syncRunId,
        workResumed: work.resumed,
        continuationPhase: destinationContinuation.phase,
        sourceProgress: destinationContinuation.progress,
      });
    }
  }
  const resourceLoad = await loadVideoResources({
    workStore,
    workKey,
    publicClient,
    videoIds,
    assertLockActive: assertCurrentWork,
    onProgress,
    sourceUnitBudget,
  });
  if (!resourceLoad.complete) {
    return buildContinuationResult({
      syncRunId,
      workResumed: work.resumed,
      continuationPhase: WORK_PHASES.CONTENT_RESOURCES,
      sourceProgress: resourceLoad,
    });
  }
  const videoResources = resourceLoad.videoResources;
  const returnedVideoIds = new Set(videoResources.map((video) => requireText(video?.id, 'video.id')));
  const requestedButUnavailable = videoIds.filter((videoId) => !returnedVideoIds.has(videoId));

  const rawChannelRows = [mapYouTubeChannelRawRow(channelResource, { expectedChannelId: channelId, fetchedAt })];
  const rawVideoRows = videoResources.map((video) => mapYouTubeVideoRawRow(video, { expectedChannelId: channelId, fetchedAt }));
  const priorIds = new Set(priorStates.map((state) => state.externalContentId).filter(Boolean));
  const missingIds = syncMode.fullSnapshot
    ? [...new Set([...requestedButUnavailable, ...[...priorIds].filter((videoId) => !videoIds.includes(videoId))])]
    : requestedButUnavailable;
  const missingContentKeys = missingIds.map((videoId) => createContentKey({
    platform: 'youtube',
    account_key: accountKey,
    external_content_id: videoId,
  }));
  const existingMissingStates = missingContentKeys.length === 0
    ? []
    : await requireHistoryGateway(historyGateway).listOrganicContentStatesByKeys(missingContentKeys);
  const existingMissingByVideoId = new Map(existingMissingStates.map((row) => [
    row.external_content_id,
    row,
  ]));
  const requestedUnavailableSet = new Set(requestedButUnavailable);
  const priorStateById = new Map(priorStates.map((state) => [state.externalContentId, state]));
  const missingRows = missingIds.map((videoId) => {
    const existing = existingMissingByVideoId.get(videoId) ?? {};
    const observedInUploadsPlaylist = requestedUnavailableSet.has(videoId);
    const lastSeenAt = observedInUploadsPlaylist
      ? fetchedAt
      : readSafeTimestamp(existing.last_observed_at)
        ?? readSafeTimestamp(priorStateById.get(videoId)?.lastSeenAt)
        ?? fetchedAt;
    const previouslyUnavailable = ['missing', 'private', 'deleted'].includes(
      existing.source_availability_status,
    );
    return mapMissingYouTubeVideoRawRow({
      channelId,
      videoId,
      fetchedAt,
      lastSeenAt,
      missingSince: previouslyUnavailable
        ? readSafeTimestamp(existing.last_changed_at) ?? fetchedAt
        : fetchedAt,
      observedInUploadsPlaylist,
    });
  });

  const normalized = normalizeYouTubeVideoBatch({
    videoResources,
    accountId: accountKey,
    channelId,
    metricDate,
    dictionaryRules: input.dictionaryRules ?? [],
  });
  if (normalized.skippedRows.length > 0 || normalized.sourceChannelIds.some((id) => id !== channelId)) {
    throw permanentError('YouTube normalization preflight failed', {
      code: 'YOUTUBE_SYNC_NOT_READY',
      details: { skippedRows: normalized.skippedRows.length, sourceChannelIds: normalized.sourceChannelIds },
    });
  }

  // Content incremental จำกัด recent window ได้ แต่ Owner Analytics ต้อง query tracked scope ทั้งหมดจาก D1 checkpoint.
  const analyticsVideoIds = analyticsRange
    ? resolveTrackedAnalyticsVideoIds({ priorStates, currentVideoIds: videoIds })
    : [];
  const analyticsLoad = analyticsRange
    ? await loadAnalyticsRows({
      workStore,
      workKey,
      ownerClient,
      channelId,
      videoIds: analyticsVideoIds,
      startDate: analyticsRange.startDate,
      endDate: analyticsRange.endDate,
      fetchedAt,
      assertLockActive: assertCurrentWork,
      maxPages: positiveInteger(input.analyticsMaxPages ?? 1000, 'analyticsMaxPages'),
      onProgress,
      sourceUnitBudget,
    })
    : emptyAnalyticsLoad();
  if (analyticsRange && analyticsLoad.completeness?.complete !== true) {
    return buildContinuationResult({
      syncRunId,
      workResumed: work.resumed,
      continuationPhase: WORK_PHASES.ANALYTICS,
      sourceProgress: analyticsLoad,
    });
  }
  const analyticsRows = analyticsLoad.rows;
  const analyticsReconciliation = analyticsRange
    ? await reconcileAnalyticsRows({
      analyticsStore: requireAnalyticsStore(analyticsStore),
      customerKey: requireText(input.customerKey, 'customerKey'),
      accountKey,
      channelId,
      videoIds: analyticsVideoIds,
      startDate: analyticsRange.startDate,
      endDate: analyticsRange.endDate,
      analyticsRows,
      analyticsCompleteness: analyticsLoad.completeness,
      assertLockActive: assertCurrentWork,
      onProgress,
    })
    : emptyAnalyticsReconciliation();

  const accountRows = [Object.freeze({
    account_key: `youtube:${accountKey}`,
    platform: 'youtube',
    account_id: channelId,
    account_name: channel.title,
    account_type: 'channel',
    connection_status: 'connected',
    timezone: requireText(input.reportingTimezone ?? 'Asia/Bangkok', 'reportingTimezone'),
    last_sync_at: fetchedAt,
  })];

  if (typeof syncEngine.captureSourceRows === 'function') {
    syncEngine.captureSourceRows({
      rawChannels: rawChannelRows,
      rawVideos: [...rawVideoRows, ...missingRows],
      rawAnalytics: analyticsRows,
    });
  }

  if (typeof syncEngine.captureCanonicalRows === 'function') {
    syncEngine.captureCanonicalRows({
      contentRows: normalized.contentRows,
      dailyRows: normalized.dailySnapshotRows,
      accountRows,
    });
  }

  if (input.dryRun === true) {
    const plans = await planAll({
      repository,
      syncEngine,
      tables,
      rows: {
        content: normalized.contentRows,
        daily: normalized.dailySnapshotRows,
        accounts: accountRows,
      },
      onProgress,
      assertCurrentWork,
    });
    const result = buildResult({
      mode: 'dry_run', syncRunId, syncMode, videoIds, videoResources, missingIds,
      inventory, resourceLoad, analyticsLoad, analyticsVideoIds, analyticsRows,
      analyticsReconciliation, plans, checkpointSaved: false, workResumed: work.resumed,
    });
    const completedResult = await applyCompletionDecorator(decorateCompletion, result);
    await workStore.completeWork({ workKey, completion: completedResult });
    return completedResult;
  }

  let plans;
  let results;
  if (maxDestinationRowsPerInvocation !== null) {
    const destination = await executeDurableDestinationPhases({
      repository,
      syncEngine,
      workStore,
      workKey,
      tables,
      rows: {
        content: normalized.contentRows,
        dailySnapshots: normalized.dailySnapshotRows,
        accounts: accountRows,
      },
      maxRows: maxDestinationRowsPerInvocation,
      maxStorageRows: maxStorageRowsPerInvocation,
      onProgress,
      assertCurrentWork,
    });
    if (!destination.complete) {
      return buildContinuationResult({
        syncRunId,
        workResumed: work.resumed,
        continuationPhase: destination.continuationPhase,
        sourceProgress: destination.progress,
      });
    }
    plans = destination.plans;
    results = destination.results;
  } else {
    plans = await planAll({
      repository,
      syncEngine,
      tables,
      rows: {
        content: normalized.contentRows,
        daily: normalized.dailySnapshotRows,
        accounts: accountRows,
      },
      onProgress,
      assertCurrentWork,
    });
    results = {};
    for (const [name, plan] of orderedPlans(plans)) {
      await assertCurrentWork();
      results[name] = await syncEngine.executePlan(plan, {
        beforeWriteChunk: assertCurrentWork,
        onProgress: (event) => onProgress({ scope: name, ...event }),
      });
    }
  }

  await assertCurrentWork();
  const completedAt = safeTimestamp(now());
  const recordStates = await buildCheckpointStates({
    videoResources,
    missingIds,
    priorStates,
  });
  const result = buildResult({
    mode: 'write', syncRunId, syncMode, videoIds, videoResources, missingIds,
    inventory, resourceLoad, analyticsLoad, analyticsVideoIds, analyticsRows,
    analyticsReconciliation, plans, results, checkpointSaved: true, workResumed: work.resumed,
  });
  const warningOutbox = await persistWarningOutbox({
    workStore,
    workKey,
    syncRunId,
    cursorKey,
    generation,
    customerProfile,
    accountKey,
    assertCurrentWork,
    result,
  });
  await assertCurrentWork();
  await stateStore.saveCheckpoint({
    cursor: {
      cursorKey,
      customerProfile,
      platform: 'youtube',
      accountKey,
      source: 'youtube_data_api',
      syncType,
      lastMetricDate: metricDate,
      dictionaryHash: null,
      lastFullSyncAt: syncMode.fullSnapshot ? completedAt : (checkpoint?.cursor?.lastFullSyncAt ?? null),
      lastSuccessfulSyncAt: completedAt,
      incrementalRunCount: syncMode.fullSnapshot ? 0 : Number(checkpoint?.cursor?.incrementalRunCount ?? 0) + 1,
      lastSyncRunId: syncRunId,
    },
    records: recordStates,
    fullSnapshot: syncMode.fullSnapshot,
    generationGuard: { cursorKey, workKey, generation, requestedAt },
  });
  const baseCompletedResult = Object.freeze({
    ...result,
    warningOutbox,
  });
  const completedResult = await applyCompletionDecorator(
    decorateCompletion,
    baseCompletedResult,
  );
  await workStore.completeWork({ workKey, completion: completedResult });

  return completedResult;
}

async function applyCompletionDecorator(decorateCompletion, completion) {
  const decorated = await decorateCompletion(completion);
  if (!decorated || typeof decorated !== 'object' || Array.isArray(decorated)) {
    throw new TypeError('YouTube completion decorator must return an object');
  }
  return Object.freeze({ ...decorated });
}

async function loadUploadInventory(input) {
  let progress = await input.workStore.loadPhase({
    workKey: input.workKey,
    phase: WORK_PHASES.CONTENT_INVENTORY,
  });
  const resumedPages = progress?.pagesProcessed ?? 0;
  while (!progress?.complete) {
    if (!input.sourceUnitBudget.tryConsume()) {
      return Object.freeze({
        videoIds: Object.freeze([]),
        pagesProcessed: progress?.pagesProcessed ?? 0,
        resumedPages,
        complete: false,
      });
    }
    const state = progress?.state ?? { pageToken: null, visitedPageTokens: [] };
    const pageToken = optionalText(state.pageToken);
    const visitedPageTokens = new Set(Array.isArray(state.visitedPageTokens)
      ? state.visitedPageTokens.map((token) => requireText(token, 'visitedPageToken'))
      : []);
    if (pageToken && visitedPageTokens.has(pageToken)) {
      throw transientError('YouTube uploads work cursor repeated a previously processed pageToken', {
        code: 'YOUTUBE_PAGINATION_TOKEN_REPEATED',
        details: { pagesProcessed: progress?.pagesProcessed ?? 0 },
      });
    }
    if ((progress?.pagesProcessed ?? 0) >= input.maxPages) {
      throw transientError('YouTube uploads pagination exceeded configured maxPages', {
        code: 'YOUTUBE_PAGINATION_LIMIT',
        details: { maxPages: input.maxPages, pagesProcessed: progress?.pagesProcessed ?? 0 },
      });
    }

    await input.assertLockActive();
    const response = await input.publicClient.listUploadVideoIdsPage({
      uploadsPlaylistId: input.uploadsPlaylistId,
      pageToken,
    });
    const uniquePageIds = uniqueTextValues(response?.videoIds ?? [], 'videoId');
    const processedBefore = progress?.processedItems ?? 0;
    const remaining = input.maxItems === null
      ? uniquePageIds.length
      : Math.max(0, input.maxItems - processedBefore);
    const acceptedIds = uniquePageIds.slice(0, remaining);
    const processedItems = processedBefore + acceptedIds.length;
    if (pageToken) visitedPageTokens.add(pageToken);
    const nextPageToken = optionalText(response?.nextPageToken);
    if (nextPageToken && visitedPageTokens.has(nextPageToken)) {
      throw transientError('YouTube uploads pagination returned a repeated pageToken', {
        code: 'YOUTUBE_PAGINATION_TOKEN_REPEATED',
        details: { pagesProcessed: (progress?.pagesProcessed ?? 0) + 1 },
      });
    }
    const complete = nextPageToken === null
      || (input.maxItems !== null && processedItems >= input.maxItems);
    const pagesProcessed = (progress?.pagesProcessed ?? 0) + 1;
    const expectedItems = complete
      ? processedItems
      : Math.max(processedItems, input.maxItems ?? processedItems);
    await input.assertLockActive();
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_INVENTORY,
      state: {
        pageToken: complete ? null : nextPageToken,
        visitedPageTokens: [...visitedPageTokens],
      },
      expectedItems,
      processedItems,
      pagesProcessed,
      chunksProcessed: 0,
      complete,
      unit: {
        unitKey: `page:${pagesProcessed}`,
        sequence: pagesProcessed - 1,
        payload: { videoIds: acceptedIds },
      },
    });
    progress = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_INVENTORY,
    });
    input.onProgress({
      stage: 'youtube_content_inventory_page',
      page: pagesProcessed,
      selectedVideos: processedItems,
      complete,
    });
  }

  const videoIds = [];
  const seenVideoIds = new Set();
  await visitWorkUnits({
    workStore: input.workStore,
    workKey: input.workKey,
    phase: WORK_PHASES.CONTENT_INVENTORY,
    visit: (unit) => {
      for (const videoId of uniqueTextValues(
        unit.payload.videoIds,
        'content inventory videoIds',
      )) {
        if (!seenVideoIds.has(videoId)) {
          seenVideoIds.add(videoId);
          videoIds.push(videoId);
        }
      }
    },
  });
  if (videoIds.length !== progress.processedItems) {
    await input.workStore.resetPhase({ workKey: input.workKey, phase: WORK_PHASES.CONTENT_INVENTORY });
    throw transientError('YouTube content inventory staging is incomplete', {
      code: 'YOUTUBE_CONTENT_INVENTORY_INCOMPLETE',
      details: {
        expectedVideos: progress.processedItems,
        stagedVideos: videoIds.length,
      },
    });
  }
  return Object.freeze({
    videoIds: Object.freeze(videoIds),
    pagesProcessed: progress.pagesProcessed,
    resumedPages,
    complete: true,
  });
}

async function loadVideoResources(input) {
  let progress = await input.workStore.loadPhase({
    workKey: input.workKey,
    phase: WORK_PHASES.CONTENT_RESOURCES,
  });
  const resumedChunks = progress?.chunksProcessed ?? 0;
  const totalChunks = Math.ceil(input.videoIds.length / VIDEO_BATCH_SIZE);
  if (!progress && input.videoIds.length === 0) {
    await input.assertLockActive();
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_RESOURCES,
      state: { chunkIndex: 0 },
      expectedItems: 0,
      processedItems: 0,
      pagesProcessed: 0,
      chunksProcessed: 0,
      complete: true,
    });
    progress = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_RESOURCES,
    });
  }

  while (!progress?.complete) {
    if (!input.sourceUnitBudget.tryConsume()) {
      return Object.freeze({
        videoResources: Object.freeze([]),
        pagesProcessed: progress?.pagesProcessed ?? 0,
        chunksProcessed: progress?.chunksProcessed ?? 0,
        resumedChunks,
        complete: false,
      });
    }
    const chunkIndex = nonNegativeInteger(progress?.state?.chunkIndex ?? 0, 'content chunkIndex');
    if (chunkIndex >= totalChunks) {
      throw transientError('YouTube content resource progress exceeded selected chunks', {
        code: 'YOUTUBE_CONTENT_RESOURCE_SCOPE_INCOMPLETE',
        details: { chunkIndex, totalChunks },
      });
    }
    const selectedIds = input.videoIds.slice(
      chunkIndex * VIDEO_BATCH_SIZE,
      (chunkIndex + 1) * VIDEO_BATCH_SIZE,
    );
    await input.assertLockActive();
    const videos = await input.publicClient.listVideos({ videoIds: selectedIds });
    const returnedIds = uniqueTextValues(
      requireArray(videos, 'YouTube video resources').map((video) => requireText(video?.id, 'video.id')),
      'video.id',
    );
    if (returnedIds.some((videoId) => !selectedIds.includes(videoId))) {
      throw permanentError('YouTube videos.list returned a resource outside the requested chunk', {
        code: 'YOUTUBE_VIDEO_SCOPE_MISMATCH',
        details: { selectedVideos: selectedIds.length, returnedVideos: returnedIds.length },
      });
    }
    const processedItems = (progress?.processedItems ?? 0) + selectedIds.length;
    const chunksProcessed = (progress?.chunksProcessed ?? 0) + 1;
    const complete = chunksProcessed >= totalChunks;
    await input.assertLockActive();
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_RESOURCES,
      state: { chunkIndex: chunkIndex + 1 },
      expectedItems: input.videoIds.length,
      processedItems,
      pagesProcessed: (progress?.pagesProcessed ?? 0) + 1,
      chunksProcessed,
      complete,
      unit: {
        unitKey: `chunk:${chunkIndex}`,
        sequence: chunkIndex,
        payload: { videos },
      },
    });
    progress = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_RESOURCES,
    });
    input.onProgress({
      stage: 'youtube_content_resource_chunk',
      chunk: chunksProcessed,
      totalChunks,
      selectedVideos: processedItems,
      returnedVideos: videos.length,
      complete,
    });
  }

  const byId = new Map();
  await visitWorkUnits({
    workStore: input.workStore,
    workKey: input.workKey,
    phase: WORK_PHASES.CONTENT_RESOURCES,
    visit: (unit) => {
      for (const video of requireArray(unit.payload.videos, 'content resource videos')) {
        const videoId = requireText(video?.id, 'video.id');
        if (byId.has(videoId)) {
          throw permanentError('YouTube content resource staging contains a duplicate Video ID', {
            code: 'YOUTUBE_VIDEO_DUPLICATE_RESOURCE',
            details: { duplicateResources: 1 },
          });
        }
        byId.set(videoId, video);
      }
    },
  });
  if (progress.processedItems !== input.videoIds.length) {
    await input.workStore.resetPhase({ workKey: input.workKey, phase: WORK_PHASES.CONTENT_RESOURCES });
    throw transientError('YouTube content resource scope is incomplete', {
      code: 'YOUTUBE_CONTENT_RESOURCE_SCOPE_INCOMPLETE',
      details: {
        expectedVideos: input.videoIds.length,
        queriedVideos: progress.processedItems,
      },
    });
  }
  return Object.freeze({
    videoResources: Object.freeze([...byId.values()]),
    pagesProcessed: progress.pagesProcessed,
    chunksProcessed: progress.chunksProcessed,
    resumedChunks,
    complete: true,
  });
}

/**
 * ตรวจเฉพาะ Stable key ที่เคยมีอยู่ในช่วงวันที่/Video ที่รอบนี้ query จริง
 * แถวที่หายจะไม่ถูกเขียนทับหรือลบ และถูกส่งเป็น Warning เพื่อให้ตรวจ Reconciliation
 */
async function reconcileAnalyticsRows(input) {
  const sourceMetricDates = enumerateDateOnlyRange(input.startDate, input.endDate);
  const videoIds = new Set(input.videoIds);
  const observedStableKeys = new Set(input.analyticsRows.map((row) => requireText(
    row.raw_analytics_daily_key,
    'raw_analytics_daily_key',
  )));
  if (videoIds.size === 0) {
    return createAnalyticsReconciliation({
      startDate: input.startDate,
      endDate: input.endDate,
      observedStableKeys: observedStableKeys.size,
      expectedVideoCount: input.analyticsCompleteness.totalTrackedVideos,
      queriedVideoCount: input.analyticsCompleteness.successfullyQueriedVideos,
      scopeComplete: input.analyticsCompleteness.complete,
    });
  }

  await input.assertLockActive();
  input.onProgress({
    stage: 'youtube_analytics_reconciliation_loading',
    sourceMetricDates: sourceMetricDates.length,
    videos: videoIds.size,
  });
  const previouslyObservedStableKeys = new Set(await input.analyticsStore.listStableKeysByScope({
    customerKey: input.customerKey,
    accountKey: input.accountKey,
    channelId: input.channelId,
    videoIds: [...videoIds],
    startDate: input.startDate,
    endDate: input.endDate,
  }));

  const missingStableKeys = [...previouslyObservedStableKeys]
    .filter((stableKey) => !observedStableKeys.has(stableKey))
    .sort();
  input.onProgress({
    stage: 'youtube_analytics_reconciliation_complete',
    previouslyObserved: previouslyObservedStableKeys.size,
    observed: observedStableKeys.size,
    missing: missingStableKeys.length,
  });
  return createAnalyticsReconciliation({
    startDate: input.startDate,
    endDate: input.endDate,
    observedStableKeys: observedStableKeys.size,
    previouslyObservedStableKeys: previouslyObservedStableKeys.size,
    missingStableKeys,
    expectedVideoCount: input.analyticsCompleteness.totalTrackedVideos,
    queriedVideoCount: input.analyticsCompleteness.successfullyQueriedVideos,
    scopeComplete: input.analyticsCompleteness.complete,
  });
}

async function loadAnalyticsRows(input) {
  if (!input.ownerClient) throw permanentError('YouTube Analytics requires OAuth owner client', { code: 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED' });
  let progress = await input.workStore.loadPhase({
    workKey: input.workKey,
    phase: WORK_PHASES.ANALYTICS,
  });
  const resumedChunks = progress?.chunksProcessed ?? 0;
  const resumedPages = progress?.pagesProcessed ?? 0;
  const totalChunks = Math.ceil(input.videoIds.length / VIDEO_BATCH_SIZE);
  if (!progress && input.videoIds.length === 0) {
    await input.assertLockActive();
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: WORK_PHASES.ANALYTICS,
      state: { chunkIndex: 0, startIndex: 1, pageInChunk: 1 },
      expectedItems: 0,
      processedItems: 0,
      pagesProcessed: 0,
      chunksProcessed: 0,
      complete: true,
    });
    progress = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.ANALYTICS,
    });
  }

  while (!progress?.complete) {
    if (!input.sourceUnitBudget.tryConsume()) {
      return Object.freeze({
        rows: Object.freeze([]),
        completeness: Object.freeze({
          status: 'partial',
          complete: false,
          totalTrackedVideos: input.videoIds.length,
          selectedVideos: input.videoIds.length,
          successfullyQueriedVideos: progress?.processedItems ?? 0,
          skippedVideos: 0,
          failedVideos: 0,
          pagesProcessed: progress?.pagesProcessed ?? 0,
          chunksProcessed: progress?.chunksProcessed ?? 0,
          totalChunks,
          resumedPages,
          resumedChunks,
        }),
        pagesProcessed: progress?.pagesProcessed ?? 0,
        chunksProcessed: progress?.chunksProcessed ?? 0,
        complete: false,
      });
    }
    const chunkIndex = nonNegativeInteger(progress?.state?.chunkIndex ?? 0, 'analytics chunkIndex');
    const startIndex = positiveInteger(progress?.state?.startIndex ?? 1, 'analytics startIndex');
    const pageInChunk = positiveInteger(progress?.state?.pageInChunk ?? 1, 'analytics pageInChunk');
    if (chunkIndex >= totalChunks) {
      await input.workStore.resetPhase({ workKey: input.workKey, phase: WORK_PHASES.ANALYTICS });
      throw transientError('YouTube Analytics work scope ended before all tracked videos were queried', {
        code: 'YOUTUBE_ANALYTICS_SCOPE_INCOMPLETE',
        details: analyticsFailureDetails(progress, input.videoIds.length, totalChunks),
      });
    }
    if (pageInChunk > input.maxPages) {
      throw permanentError('YouTube Analytics pagination exceeded maxPages', {
        code: 'YOUTUBE_ANALYTICS_PAGINATION_LIMIT',
        details: {
          maxPages: input.maxPages,
          ...analyticsFailureDetails(progress, input.videoIds.length, totalChunks),
        },
      });
    }

    const videoIds = input.videoIds.slice(
      chunkIndex * VIDEO_BATCH_SIZE,
      (chunkIndex + 1) * VIDEO_BATCH_SIZE,
    );
    await input.assertLockActive();
    let response;
    try {
      response = await input.ownerClient.queryAnalytics({
        channelId: input.channelId,
        startDate: input.startDate,
        endDate: input.endDate,
        metrics: ANALYTICS_METRICS,
        dimensions: ANALYTICS_DIMENSIONS,
        filters: `video==${videoIds.join(',')}`,
        sort: ANALYTICS_SORT,
        maxResults: ANALYTICS_PAGE_SIZE,
        startIndex,
      });
    } catch (error) {
      throw analyticsProgressError(error, progress, input.videoIds.length, totalChunks);
    }
    const mapped = validateYouTubeAnalyticsRowsScope(mapYouTubeAnalyticsResponse(response, {
      channelId: input.channelId,
      fetchedAt: input.fetchedAt,
    }), {
      channelId: input.channelId,
      videoIds,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    const chunkComplete = mapped.length < ANALYTICS_PAGE_SIZE;
    const chunksProcessed = (progress?.chunksProcessed ?? 0) + (chunkComplete ? 1 : 0);
    const processedItems = (progress?.processedItems ?? 0) + (chunkComplete ? videoIds.length : 0);
    const pagesProcessed = (progress?.pagesProcessed ?? 0) + 1;
    const complete = chunkComplete && chunksProcessed >= totalChunks;
    const nextState = chunkComplete
      ? { chunkIndex: chunkIndex + 1, startIndex: 1, pageInChunk: 1 }
      : {
        chunkIndex,
        startIndex: startIndex + mapped.length,
        pageInChunk: pageInChunk + 1,
      };
    await input.assertLockActive();
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: WORK_PHASES.ANALYTICS,
      state: nextState,
      expectedItems: input.videoIds.length,
      processedItems,
      pagesProcessed,
      chunksProcessed,
      complete,
      unit: {
        unitKey: `chunk:${chunkIndex}:start:${startIndex}`,
        sequence: pagesProcessed - 1,
        payload: {
          rows: mapped,
          queriedVideoIds: chunkComplete ? videoIds : [],
        },
      },
    });
    progress = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.ANALYTICS,
    });
    input.onProgress({
      stage: 'youtube_analytics_page',
      page: pagesProcessed,
      chunk: chunksProcessed,
      totalChunks,
      successfullyQueriedVideos: processedItems,
      totalTrackedVideos: input.videoIds.length,
      complete,
    });
  }

  if (input.deferCompletedRead === true) {
    return Object.freeze({
      rows: Object.freeze([]),
      completeness: Object.freeze({
        status: 'complete',
        complete: true,
        totalTrackedVideos: input.videoIds.length,
        selectedVideos: input.videoIds.length,
        successfullyQueriedVideos: progress.processedItems,
        skippedVideos: 0,
        failedVideos: 0,
        pagesProcessed: progress.pagesProcessed,
        chunksProcessed: progress.chunksProcessed,
        totalChunks,
        resumedPages,
        resumedChunks,
      }),
      pagesProcessed: progress.pagesProcessed,
      chunksProcessed: progress.chunksProcessed,
      complete: true,
    });
  }

  const rows = [];
  const stableKeys = new Set();
  const queriedVideoIds = new Set();
  await visitWorkUnits({
    workStore: input.workStore,
    workKey: input.workKey,
    phase: WORK_PHASES.ANALYTICS,
    visit: (unit) => {
      for (const row of requireArray(unit.payload.rows, 'analytics rows')) {
        const stableKey = requireText(row?.raw_analytics_daily_key, 'raw_analytics_daily_key');
        if (stableKeys.has(stableKey)) {
          throw permanentError('YouTube Analytics pagination returned a duplicate stable row', {
            code: 'YOUTUBE_ANALYTICS_DUPLICATE_ROW',
            details: { duplicateRows: 1 },
          });
        }
        stableKeys.add(stableKey);
        rows.push(row);
      }
      for (const videoId of requireArray(unit.payload.queriedVideoIds, 'queriedVideoIds')) {
        queriedVideoIds.add(requireText(videoId, 'queriedVideoId'));
      }
    },
  });
  const expectedVideoIds = new Set(input.videoIds);
  const missingVideoCount = input.videoIds.filter((videoId) => !queriedVideoIds.has(videoId)).length;
  const unexpectedVideoCount = [...queriedVideoIds].filter((videoId) => !expectedVideoIds.has(videoId)).length;
  const scopeComplete = progress.complete
    && progress.processedItems === input.videoIds.length
    && missingVideoCount === 0
    && unexpectedVideoCount === 0;
  if (!scopeComplete) {
    await input.workStore.resetPhase({ workKey: input.workKey, phase: WORK_PHASES.ANALYTICS });
    throw transientError('YouTube Analytics tracked-video scope is incomplete', {
      code: 'YOUTUBE_ANALYTICS_SCOPE_INCOMPLETE',
      details: {
        ...analyticsFailureDetails(progress, input.videoIds.length, totalChunks),
        missingVideoCount,
        unexpectedVideoCount,
      },
    });
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    completeness: Object.freeze({
      status: 'complete',
      complete: true,
      totalTrackedVideos: input.videoIds.length,
      selectedVideos: input.videoIds.length,
      successfullyQueriedVideos: queriedVideoIds.size,
      skippedVideos: 0,
      failedVideos: 0,
      pagesProcessed: progress.pagesProcessed,
      chunksProcessed: progress.chunksProcessed,
      totalChunks,
      resumedPages,
      resumedChunks,
    }),
  });
}

async function assertOwnerChannel({ ownerClient, channelId }) {
  if (!ownerClient) throw permanentError('YouTube Analytics requires OAuth owner credentials', { code: 'YOUTUBE_ANALYTICS_OAUTH_REQUIRED' });
  const owner = await ownerClient.getChannel({ mine: true });
  mapYouTubeChannelResource(owner, channelId);
}

function createSourceUnitBudget(value) {
  if (value === null || value === undefined || value === '') {
    return Object.freeze({ tryConsume: () => true });
  }
  const maximum = positiveInteger(value, 'maxSourceUnitsPerInvocation');
  let consumed = 0;
  return Object.freeze({
    tryConsume() {
      if (consumed >= maximum) return false;
      consumed += 1;
      return true;
    },
  });
}

async function continueExistingYouTubeStoragePhase(input) {
  if (typeof input.syncEngine.executeStorageBatch !== 'function') return null;
  const start = nonNegativeInteger(
    input.existingStoragePhase?.state?.nextIndex ?? 0,
    'youtube storage nextIndex',
  );
  const expectedItems = nonNegativeInteger(
    input.existingStoragePhase?.expectedItems ?? 0,
    'youtube storage expectedItems',
  );
  if (start >= expectedItems) return null;

  let returnedVideoIds = input.existingStoragePhase?.state?.returnedVideoIds;
  if (!Array.isArray(returnedVideoIds)) {
    const observed = [];
    const seen = new Set();
    await visitWorkUnits({
      workStore: input.workStore,
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_RESOURCES,
      visit: (unit) => {
        for (const video of requireArray(unit.payload.videos, 'content resource videos')) {
          const videoId = requireText(video?.id, 'video.id');
          if (seen.has(videoId)) {
            throw permanentError('YouTube content resource staging contains a duplicate Video ID', {
              code: 'YOUTUBE_VIDEO_DUPLICATE_RESOURCE',
              details: { duplicateResources: 1 },
            });
          }
          seen.add(videoId);
          observed.push(videoId);
        }
      },
    });
    returnedVideoIds = observed;
  }
  const inventoryIndex = new Map(input.videoIds.map((videoId, index) => [videoId, index]));
  if (returnedVideoIds.some((videoId) => !inventoryIndex.has(videoId))) {
    throw permanentError('YouTube staged resource is outside the retained inventory', {
      code: 'YOUTUBE_VIDEO_SCOPE_MISMATCH',
    });
  }
  const sortedReturnedIds = Object.freeze([...returnedVideoIds].sort((left, right) => (
    left.localeCompare(right)
  )));
  if (sortedReturnedIds.length !== expectedItems) {
    throw transientError('YouTube D1 storage expected count differs from staged resources', {
      code: 'YOUTUBE_CONTENT_RESOURCE_SCOPE_INCOMPLETE',
      details: { expectedVideos: expectedItems, stagedVideos: sortedReturnedIds.length },
    });
  }
  const selectedIds = sortedReturnedIds.slice(start, start + input.maxRows);
  const videoResources = await loadSelectedVideoResources({
    workStore: input.workStore,
    workKey: input.workKey,
    inventoryIndex,
    selectedIds,
  });
  const normalized = normalizeYouTubeVideoBatch({
    videoResources,
    accountId: input.accountKey,
    channelId: input.channelId,
    metricDate: input.metricDate,
    dictionaryRules: input.dictionaryRules ?? [],
  });
  if (normalized.skippedRows.length > 0
    || normalized.sourceChannelIds.some((id) => id !== input.channelId)) {
    throw permanentError('YouTube bounded normalization preflight failed', {
      code: 'YOUTUBE_SYNC_NOT_READY',
      details: { skippedRows: normalized.skippedRows.length },
    });
  }
  const rawChannels = [mapYouTubeChannelRawRow(input.channelResource, {
    expectedChannelId: input.channelId,
    fetchedAt: input.fetchedAt,
  })];
  const rawVideos = videoResources.map((video) => mapYouTubeVideoRawRow(video, {
    expectedChannelId: input.channelId,
    fetchedAt: input.fetchedAt,
  }));
  const accountRows = [Object.freeze({
    account_key: `youtube:${input.accountKey}`,
    platform: 'youtube',
    account_id: input.channelId,
    account_name: mapYouTubeChannelResource(input.channelResource, input.channelId).title,
    account_type: 'channel',
    connection_status: 'connected',
    timezone: requireText(input.reportingTimezone ?? 'Asia/Bangkok', 'reportingTimezone'),
    last_sync_at: input.fetchedAt,
  })];
  input.syncEngine.captureSourceRows({ rawChannels, rawVideos, rawAnalytics: [] });
  input.syncEngine.captureCanonicalRows({
    contentRows: normalized.contentRows,
    dailyRows: normalized.dailySnapshotRows,
    accountRows,
  });
  await input.assertCurrentWork();
  const priorTotals = input.existingStoragePhase?.state?.contentTotals
    ?? emptyYouTubeStorageContentTotals();
  const batch = await input.syncEngine.executeStorageBatch({
    startIndex: start,
    maxRows: input.maxRows,
    expectedItems,
    preselected: true,
    contentTotals: priorTotals,
  });
  const contentTotals = addYouTubeStorageContentTotals(priorTotals, batch.content);
  await input.assertCurrentWork();
  await input.workStore.savePhase({
    workKey: input.workKey,
    phase: WORK_PHASES.D1_STORAGE,
    state: {
      storage: null,
      contentTotals,
      nextIndex: batch.nextIndex,
      returnedVideoIds: sortedReturnedIds,
    },
    expectedItems,
    processedItems: batch.nextIndex,
    pagesProcessed: 0,
    chunksProcessed: Number(input.existingStoragePhase?.chunksProcessed ?? 0) + 1,
    complete: false,
    unit: {
      unitKey: `rows:${start}-${batch.nextIndex}`,
      sequence: Number(input.existingStoragePhase?.chunksProcessed ?? 0),
      payload: { nextIndex: batch.nextIndex, complete: false },
    },
  });
  return Object.freeze({
    complete: false,
    expectedItems,
    processedItems: batch.nextIndex,
    chunksProcessed: Number(input.existingStoragePhase?.chunksProcessed ?? 0) + 1,
  });
}

async function continueExistingYouTubeDestinationPhase(input) {
  const contentPhase = await input.workStore.loadPhase({
    workKey: input.workKey,
    phase: WORK_PHASES.DESTINATION_CONTENT,
  });
  const dailyPhase = contentPhase?.complete
    ? await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.DESTINATION_DAILY,
    })
    : null;
  if ((!contentPhase || contentPhase.complete)
    && (!dailyPhase || dailyPhase.complete)) return null;

  let phase;
  let tableId;
  let keyField;
  let scope;
  let existing;
  let rows;
  let expectedItems;
  if (contentPhase && !contentPhase.complete) {
    phase = WORK_PHASES.DESTINATION_CONTENT;
    tableId = input.tables.mktContent;
    keyField = 'content_key';
    scope = 'content';
    existing = contentPhase;
  } else {
    phase = WORK_PHASES.DESTINATION_DAILY;
    tableId = input.tables.mktContentDaily;
    keyField = 'content_daily_key';
    scope = 'dailySnapshots';
    existing = dailyPhase;
  }

  const state = normalizeYouTubeDestinationState(existing?.state);
  const start = state.nextIndex;
  expectedItems = nonNegativeInteger(existing.expectedItems, 'youtube destination expectedItems');
  if (expectedItems !== input.videoIds.length) return null;
  const stop = Math.min(expectedItems, start + input.maxRows);
  const selectedIds = input.videoIds.slice(start, stop);
  const inventoryIndex = new Map(input.videoIds.map((videoId, index) => [videoId, index]));
  const videoResources = await loadSelectedVideoResources({
    workStore: input.workStore,
    workKey: input.workKey,
    inventoryIndex,
    selectedIds,
  });
  const normalized = normalizeYouTubeVideoBatch({
    videoResources,
    accountId: input.accountKey,
    channelId: input.channelId,
    metricDate: input.metricDate,
    dictionaryRules: input.dictionaryRules ?? [],
  });
  if (normalized.skippedRows.length > 0
    || normalized.sourceChannelIds.some((id) => id !== input.channelId)) {
    throw permanentError('YouTube bounded destination normalization preflight failed', {
      code: 'YOUTUBE_SYNC_NOT_READY',
      details: { skippedRows: normalized.skippedRows.length },
    });
  }
  rows = phase === WORK_PHASES.DESTINATION_CONTENT
    ? normalized.contentRows
    : normalized.dailySnapshotRows;
  let plan = emptyYouTubePlanSummary();
  let result = emptyYouTubeWriteResult();
  if (rows.length > 0) {
    await input.assertCurrentWork();
    const batchPlan = await input.syncEngine.planByKey({
      repository: input.repository,
      tableId,
      keyField,
      rows,
      onProgress: (event) => input.onProgress({ scope, ...event }),
    });
    plan = summarizeYouTubePlan(batchPlan);
    result = await input.syncEngine.executePlan(batchPlan, {
      beforeWriteChunk: input.assertCurrentWork,
      onProgress: (event) => input.onProgress({ scope, ...event }),
    });
  }
  const nextState = {
    nextIndex: stop,
    plan: addYouTubePlanSummary(state.plan, plan),
    result: addYouTubeWriteResult(state.result, result),
  };
  const complete = stop >= expectedItems;
  const priorChunksProcessed = Number(existing?.chunksProcessed ?? 0);
  const chunksProcessed = priorChunksProcessed + (rows.length > 0 ? 1 : 0);
  await input.assertCurrentWork();
  await input.workStore.savePhase({
    workKey: input.workKey,
    phase,
    state: nextState,
    expectedItems,
    processedItems: stop,
    pagesProcessed: 0,
    chunksProcessed,
    complete,
    ...(rows.length > 0 ? {
      unit: {
        unitKey: `rows:${start}-${stop}`,
        sequence: priorChunksProcessed,
        payload: { start, stop, plan, result },
      },
    } : {}),
  });
  return Object.freeze({
    phase,
    progress: Object.freeze({ complete, processedItems: stop, expectedItems }),
  });
}

async function loadSelectedVideoResources(input) {
  const selectedSet = new Set(input.selectedIds);
  const chunkIndexes = [...new Set(input.selectedIds.map((videoId) => {
    const index = input.inventoryIndex.get(videoId);
    if (index === undefined) {
      throw permanentError('YouTube selected Video is outside the retained inventory', {
        code: 'YOUTUBE_VIDEO_SCOPE_MISMATCH',
      });
    }
    return Math.floor(index / VIDEO_BATCH_SIZE);
  }))].sort((left, right) => left - right);
  const selectedById = new Map();
  for (const chunkIndex of chunkIndexes) {
    const page = await input.workStore.listPhaseUnits({
      workKey: input.workKey,
      phase: WORK_PHASES.CONTENT_RESOURCES,
      afterSequence: chunkIndex,
      limit: 1,
    });
    const unit = requireArray(page?.units, 'content resource unit page')[0];
    if (!unit || unit.sequence !== chunkIndex) {
      throw transientError('YouTube content resource unit is unavailable for bounded continuation', {
        code: 'YOUTUBE_CONTENT_RESOURCE_SCOPE_INCOMPLETE',
        details: { chunkIndex },
      });
    }
    for (const video of requireArray(unit.payload.videos, 'content resource videos')) {
      const videoId = requireText(video?.id, 'video.id');
      if (selectedSet.has(videoId)) selectedById.set(videoId, video);
    }
  }
  const resources = input.selectedIds.map((videoId) => selectedById.get(videoId));
  if (resources.some((video) => !video)) {
    throw transientError('YouTube bounded continuation could not hydrate every selected Video resource', {
      code: 'YOUTUBE_CONTENT_RESOURCE_SCOPE_INCOMPLETE',
      details: { selectedVideos: input.selectedIds.length, hydratedVideos: selectedById.size },
    });
  }
  return Object.freeze(resources);
}

async function executeDurableDestinationPhases(input) {
  const definitions = [
    Object.freeze({
      name: 'content',
      phase: WORK_PHASES.DESTINATION_CONTENT,
      tableId: input.tables.mktContent,
      keyField: 'content_key',
      rows: input.rows.content,
    }),
    Object.freeze({
      name: 'dailySnapshots',
      phase: WORK_PHASES.DESTINATION_DAILY,
      tableId: input.tables.mktContentDaily,
      keyField: 'content_daily_key',
      rows: input.rows.dailySnapshots,
    }),
    Object.freeze({
      name: 'accounts',
      phase: WORK_PHASES.DESTINATION_ACCOUNTS,
      tableId: input.tables.mktAccounts,
      keyField: 'account_key',
      rows: input.rows.accounts,
    }),
  ];

  if (typeof input.syncEngine.executeStorage === 'function') {
    const storagePhase = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: WORK_PHASES.D1_STORAGE,
    });
    if (!storagePhase?.complete) {
      await input.assertCurrentWork();
      const priorTotals = storagePhase?.state?.contentTotals ?? emptyYouTubeStorageContentTotals();
      const batch = typeof input.syncEngine.executeStorageBatch === 'function'
        ? await input.syncEngine.executeStorageBatch({
          startIndex: Number(storagePhase?.state?.nextIndex ?? 0),
          maxRows: input.maxStorageRows,
          contentTotals: priorTotals,
        })
        : null;
      const storage = batch === null
        ? compactYouTubeStorageResult(await input.syncEngine.executeStorage())
        : batch.complete
          ? compactYouTubeStorageResult(batch.storage)
          : null;
      const contentTotals = batch?.complete
        ? storage.content
        : addYouTubeStorageContentTotals(priorTotals, batch?.content);
      const complete = batch === null || batch.complete === true;
      const nextIndex = batch?.nextIndex ?? 1;
      const expectedItems = batch?.expectedItems ?? 1;
      await input.assertCurrentWork();
      await input.workStore.savePhase({
        workKey: input.workKey,
        phase: WORK_PHASES.D1_STORAGE,
        state: { storage: complete ? storage : null, contentTotals, nextIndex },
        expectedItems,
        processedItems: nextIndex,
        pagesProcessed: 0,
        chunksProcessed: Number(storagePhase?.chunksProcessed ?? 0) + 1,
        complete,
        unit: {
          unitKey: `rows:${Math.max(0, nextIndex - input.maxStorageRows)}-${nextIndex}`,
          sequence: Number(storagePhase?.chunksProcessed ?? 0),
          payload: { nextIndex, complete },
        },
      });
      return durableDestinationContinuation(WORK_PHASES.D1_STORAGE, nextIndex, expectedItems);
    }
    if (typeof input.syncEngine.resumeStorage === 'function') {
      input.syncEngine.resumeStorage(storagePhase.state?.storage);
    }
  }

  const plans = {};
  const results = {};
  for (const definition of definitions) {
    const existing = await input.workStore.loadPhase({
      workKey: input.workKey,
      phase: definition.phase,
    });
    const state = normalizeYouTubeDestinationState(existing?.state);
    if (existing?.complete) {
      plans[definition.name] = state.plan;
      results[definition.name] = state.result;
      continue;
    }

    const start = state.nextIndex;
    const stop = Math.min(definition.rows.length, start + input.maxRows);
    const rows = definition.rows.slice(start, stop);
    let plan = emptyYouTubePlanSummary();
    let result = emptyYouTubeWriteResult();
    if (rows.length > 0) {
      await input.assertCurrentWork();
      const batchPlan = await input.syncEngine.planByKey({
        repository: input.repository,
        tableId: definition.tableId,
        keyField: definition.keyField,
        rows,
        onProgress: (event) => input.onProgress({ scope: definition.name, ...event }),
      });
      plan = summarizeYouTubePlan(batchPlan);
      result = await input.syncEngine.executePlan(batchPlan, {
        beforeWriteChunk: input.assertCurrentWork,
        onProgress: (event) => input.onProgress({ scope: definition.name, ...event }),
      });
    }
    const nextState = {
      nextIndex: stop,
      plan: addYouTubePlanSummary(state.plan, plan),
      result: addYouTubeWriteResult(state.result, result),
    };
    const complete = stop >= definition.rows.length;
    const priorChunksProcessed = Number(existing?.chunksProcessed ?? 0);
    const chunksProcessed = priorChunksProcessed + (rows.length > 0 ? 1 : 0);
    await input.assertCurrentWork();
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: definition.phase,
      state: nextState,
      expectedItems: definition.rows.length,
      processedItems: stop,
      pagesProcessed: 0,
      chunksProcessed,
      complete,
      ...(rows.length > 0 ? {
        unit: {
          unitKey: `rows:${start}-${stop}`,
          sequence: priorChunksProcessed,
          payload: { start, stop, plan, result },
        },
      } : {}),
    });
    plans[definition.name] = nextState.plan;
    results[definition.name] = nextState.result;

    const remaining = definitions.some((candidate) => {
      if (candidate.phase === definition.phase) return !complete;
      return definitions.indexOf(candidate) > definitions.indexOf(definition);
    });
    if (remaining) {
      return {
        ...durableDestinationContinuation(definition.phase, stop, definition.rows.length),
        plans: Object.freeze(plans),
        results: Object.freeze(results),
      };
    }
  }
  return Object.freeze({
    complete: true,
    plans: Object.freeze(plans),
    results: Object.freeze(results),
  });
}

function durableDestinationContinuation(phase, processedItems, expectedItems) {
  return Object.freeze({
    complete: false,
    continuationPhase: phase,
    progress: Object.freeze({ complete: false, processedItems, expectedItems }),
  });
}

function normalizeYouTubeDestinationState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    nextIndex: Number.isSafeInteger(source.nextIndex) && source.nextIndex >= 0 ? source.nextIndex : 0,
    plan: addYouTubePlanSummary(emptyYouTubePlanSummary(), source.plan),
    result: addYouTubeWriteResult(emptyYouTubeWriteResult(), source.result),
  };
}

function summarizeYouTubePlan(plan) {
  return Object.freeze({
    createRows: Array.isArray(plan?.createRows) ? plan.createRows.length : 0,
    updateRows: Array.isArray(plan?.updateRows) ? plan.updateRows.length : 0,
    skipped: Number(plan?.skipped ?? 0),
    duplicateInputRows: Number(plan?.duplicateInputRows ?? 0),
  });
}

function emptyYouTubePlanSummary() {
  return Object.freeze({ createRows: 0, updateRows: 0, skipped: 0, duplicateInputRows: 0 });
}

function emptyYouTubeWriteResult() {
  return Object.freeze({ created: 0, updated: 0, skipped: 0, duplicateInputRows: 0 });
}

function addYouTubePlanSummary(left, right) {
  return Object.freeze({
    createRows: Number(left?.createRows ?? 0) + Number(right?.createRows ?? 0),
    updateRows: Number(left?.updateRows ?? 0) + Number(right?.updateRows ?? 0),
    skipped: Number(left?.skipped ?? 0) + Number(right?.skipped ?? 0),
    duplicateInputRows: Number(left?.duplicateInputRows ?? 0) + Number(right?.duplicateInputRows ?? 0),
  });
}

function addYouTubeWriteResult(left, right) {
  return Object.freeze({
    created: Number(left?.created ?? 0) + Number(right?.created ?? 0),
    updated: Number(left?.updated ?? 0) + Number(right?.updated ?? 0),
    skipped: Number(left?.skipped ?? 0) + Number(right?.skipped ?? 0),
    duplicateInputRows: Number(left?.duplicateInputRows ?? 0) + Number(right?.duplicateInputRows ?? 0),
  });
}

function compactYouTubeStorageResult(value) {
  if (!value || typeof value !== 'object') return Object.freeze({ status: 'complete' });
  const content = value.content && typeof value.content === 'object'
    ? Object.freeze({ ...value.content, classifications: Object.freeze([]) })
    : value.content;
  return Object.freeze({ ...value, content });
}

function emptyYouTubeStorageContentTotals() {
  return Object.freeze({
    contentRows: 0,
    stateWritten: 0,
    stateSkipped: 0,
    observationsCreated: 0,
    observationsSkipped: 0,
    observationsNotRequired: 0,
    coverageEntitiesWritten: 0,
    coverageEntitiesSkipped: 0,
    classifications: Object.freeze([]),
  });
}

function addYouTubeStorageContentTotals(left, right) {
  const result = {};
  for (const key of [
    'contentRows', 'stateWritten', 'stateSkipped', 'observationsCreated',
    'observationsSkipped', 'observationsNotRequired', 'coverageEntitiesWritten',
    'coverageEntitiesSkipped',
  ]) {
    result[key] = Number(left?.[key] ?? 0) + Number(right?.[key] ?? 0);
  }
  result.classifications = Object.freeze([]);
  return Object.freeze(result);
}

function buildContinuationResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'youtube',
    source: 'youtube_data_api',
    mode: 'continuation',
    status: 'continuation_required',
    continuationRequired: true,
    continuationPhase: input.continuationPhase,
    sourceProgress: input.sourceProgress,
    checkpointSaved: false,
    warnings: Object.freeze([]),
    resumableWork: Object.freeze({
      resumed: input.workResumed === true,
      complete: false,
      cleared: false,
    }),
  });
}

async function planAll(input) {
  const definitions = [
    ['content', input.tables.mktContent, 'content_key', input.rows.content],
    ['dailySnapshots', input.tables.mktContentDaily, 'content_daily_key', input.rows.daily],
    // Account ต้อง Execute สุดท้ายเพื่อไม่ประกาศ connected ก่อน RAW/Canonical writes ผ่าน
    ['accounts', input.tables.mktAccounts, 'account_key', input.rows.accounts],
  ];
  const result = {};
  for (const [name, tableId, keyField, rows] of definitions) {
    await input.assertCurrentWork();
    result[name] = await input.syncEngine.planByKey({
      repository: input.repository,
      tableId,
      keyField,
      rows,
      onProgress: (event) => input.onProgress({ scope: name, ...event }),
    });
  }
  return Object.freeze(result);
}

function orderedPlans(plans) {
  return ['content', 'dailySnapshots', 'accounts']
    .map((name) => [name, plans[name]]);
}

async function buildCheckpointStates({ videoResources, missingIds, priorStates }) {
  const states = [];
  for (const video of videoResources) {
    states.push(Object.freeze({
      sourceRecordId: requireText(video.id, 'video.id'),
      sourceModifiedAt: Date.parse(video?.snippet?.publishedAt ?? '') || null,
      sourceHash: await createStableFingerprint(video),
      externalContentId: requireText(video.id, 'video.id'),
    }));
  }
  const priorById = new Map(priorStates.map((state) => [state.externalContentId, state]));
  for (const videoId of missingIds) {
    const prior = priorById.get(videoId);
    states.push(Object.freeze({
      sourceRecordId: videoId,
      sourceModifiedAt: prior?.sourceModifiedAt ?? null,
      sourceHash: await createStableFingerprint({ videoId, availability: 'missing' }),
      externalContentId: videoId,
    }));
  }
  return dedupeBy(states, (state) => state.sourceRecordId);
}

function decideSyncMode(input) {
  const requested = optionalText(input.requested)?.toLowerCase() ?? 'auto';
  if (!['auto', 'full', 'incremental'].includes(requested)) {
    throw permanentError(`Unsupported YouTube syncMode: ${requested}`, { code: 'MKT_RUNTIME_CONFIG_INVALID' });
  }
  if (requested === 'full') return Object.freeze({ requested, mode: 'full', reason: 'manual_full', fullSnapshot: true });
  if (!input.checkpoint?.cursor) return Object.freeze({ requested, mode: 'full', reason: 'initial_checkpoint', fullSnapshot: true });
  if (input.checkpoint.cursor.lastFullSyncAt === null
    || input.now - input.checkpoint.cursor.lastFullSyncAt >= input.fullSyncIntervalMs) {
    return Object.freeze({ requested, mode: 'full', reason: 'periodic_reconciliation', fullSnapshot: true });
  }
  return Object.freeze({ requested, mode: 'incremental', reason: 'recent_upload_window', fullSnapshot: false });
}

function resolveTrackedAnalyticsVideoIds(input) {
  const trackedIds = [];
  for (const state of input.priorStates) {
    const videoId = optionalText(state?.externalContentId);
    if (videoId) trackedIds.push(videoId);
  }
  for (const videoId of input.currentVideoIds) trackedIds.push(requireText(videoId, 'videoId'));
  return Object.freeze([...new Set(trackedIds)].sort());
}

async function persistWarningOutbox(input) {
  if (!Array.isArray(input.result.warnings) || input.result.warnings.length === 0) return null;
  const warningTypes = [...new Set(input.result.warnings
    .map((warning) => requireText(warning.code, 'warning.code')))]
    .sort();
  const fingerprint = await createStableFingerprint({
    workKey: input.workKey,
    warningTypes,
    sourceKey: input.cursorKey,
  });
  const outboxId = `sync-warning:${fingerprint}`;
  await input.assertCurrentWork();
  await input.workStore.saveWarningOutbox({
    outboxId,
    workKey: input.workKey,
    syncRunId: input.syncRunId,
    warningType: 'sync_completed_with_warnings',
    sourceKey: input.cursorKey,
    generationGuard: {
      cursorKey: input.cursorKey,
      generation: input.generation,
      workKey: input.workKey,
    },
    payload: {
      context: {
        customerProfile: input.customerProfile,
        accountKey: input.accountKey,
        platform: 'youtube',
        source: 'youtube_data_api',
      },
      warnings: input.result.warnings,
      reconciliation: input.result.reconciliation,
      sourceSummary: input.result.sourceSummary,
    },
  });
  await input.assertCurrentWork();
  return Object.freeze({ outboxId, status: 'pending' });
}

async function replayCompletedWork(input) {
  const completion = input.completion && typeof input.completion === 'object'
    ? input.completion
    : {};
  if (completion.dryRun === true) {
    return Object.freeze({
      ...completion,
      syncRunId: input.syncRunId,
      platform: 'youtube',
      source: 'youtube_data_api',
      mode: 'already_completed',
      warnings: Object.freeze([...(completion.warnings ?? [])]),
      reconciliation: completion.reconciliation ?? null,
      sourceSummary: completion.sourceSummary ?? null,
      warningOutbox: null,
      checkpointSaved: false,
      resumableWork: Object.freeze({
        resumed: true,
        complete: true,
        cleared: true,
        completionReplay: true,
      }),
    });
  }
  const pending = await input.workStore.listPendingWarnings({ workKey: input.workKey });
  if (pending.length === 0) {
    return Object.freeze({
      ...completion,
      syncRunId: input.syncRunId,
      platform: 'youtube',
      source: 'youtube_data_api',
      mode: 'already_completed',
      warnings: Object.freeze([]),
      warningOutbox: null,
      checkpointSaved: true,
      resumableWork: Object.freeze({
        resumed: true,
        complete: true,
        cleared: true,
        completionReplay: true,
      }),
    });
  }
  const event = pending[0];
  return Object.freeze({
    ...completion,
    syncRunId: input.syncRunId,
    platform: 'youtube',
    source: 'youtube_data_api',
    mode: 'completion_replay',
    warnings: Object.freeze([...(event.payload?.warnings ?? [])]),
    reconciliation: event.payload?.reconciliation ?? completion.reconciliation ?? null,
    sourceSummary: event.payload?.sourceSummary ?? completion.sourceSummary ?? null,
    warningOutbox: Object.freeze({ outboxId: event.outboxId, status: 'pending' }),
    checkpointSaved: true,
    resumableWork: Object.freeze({
      resumed: true,
      complete: true,
      cleared: true,
      completionReplay: true,
    }),
  });
}

function supersededResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'youtube',
    source: 'youtube_data_api',
    dryRun: false,
    mode: 'superseded',
    rawRecords: 0,
    warnings: Object.freeze([]),
    warningOutbox: null,
    checkpointSaved: false,
    generation: input.generation,
    resumableWork: Object.freeze({
      resumed: false,
      complete: true,
      cleared: false,
      superseded: true,
    }),
  });
}

function buildResult(input) {
  const summaries = Object.fromEntries(Object.entries(input.plans).map(([name, plan]) => [name, Object.freeze({
    createRows: planCount(plan.createRows),
    updateRows: planCount(plan.updateRows),
    skipped: plan.skipped,
    ...(input.results?.[name] ? { result: input.results[name] } : {}),
  })]));
  const output = (name) => input.results?.[name] ?? Object.freeze({
    created: 0,
    updated: 0,
    skipped: input.plans[name].skipped,
    writeOutcome: input.mode === 'dry_run' ? 'not_started' : null,
  });
  const videoWarnings = input.missingIds.map((videoId) => Object.freeze({
    code: 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED',
    videoId,
    message: 'Retained prior D1 video metrics because the current traversal could not return the video resource.',
  }));
  const analyticsWarnings = input.analyticsReconciliation.missingStableKeys.length > 0
    ? [Object.freeze({
      code: 'YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED',
      missingStableKeys: input.analyticsReconciliation.missingStableKeys,
      missingCount: input.analyticsReconciliation.missingStableKeys.length,
      message: 'Retained previously observed D1 Analytics facts that disappeared from the current re-fetch.',
    })]
    : [];
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'youtube',
    source: 'youtube_data_api',
    dryRun: input.mode === 'dry_run',
    mode: input.mode,
    incremental: input.syncMode,
    rawRecords: 1 + input.videoResources.length + input.analyticsRows.length,
    warnings: Object.freeze([...videoWarnings, ...analyticsWarnings]),
    reconciliation: Object.freeze({
      required: input.missingIds.length > 0
        || input.analyticsReconciliation.missingStableKeys.length > 0,
      missingVideoIds: Object.freeze([...input.missingIds]),
      missingAnalyticsStableKeys: input.analyticsReconciliation.missingStableKeys,
      analytics: input.analyticsReconciliation,
      policy: 'retain_prior_metrics_never_delete_or_zero_fill',
    }),
    sourceSummary: Object.freeze({
      playlistVideoIds: input.videoIds.length,
      contentInventoryPages: input.inventory.pagesProcessed,
      contentInventoryResumedPages: input.inventory.resumedPages,
      videoResources: input.videoResources.length,
      contentResourceChunks: input.resourceLoad.chunksProcessed,
      contentResourceResumedChunks: input.resourceLoad.resumedChunks,
      missingVideos: input.missingIds.length,
      analyticsTrackedVideoIds: input.analyticsVideoIds.length,
      analyticsSelectedVideos: input.analyticsLoad.completeness.selectedVideos,
      analyticsSuccessfullyQueriedVideos: input.analyticsLoad.completeness.successfullyQueriedVideos,
      analyticsSkippedVideos: input.analyticsLoad.completeness.skippedVideos,
      analyticsFailedVideos: input.analyticsLoad.completeness.failedVideos,
      analyticsPagesProcessed: input.analyticsLoad.completeness.pagesProcessed,
      analyticsChunksProcessed: input.analyticsLoad.completeness.chunksProcessed,
      analyticsTotalChunks: input.analyticsLoad.completeness.totalChunks,
      analyticsCompletenessStatus: input.analyticsLoad.completeness.status,
      analyticsRows: input.analyticsRows.length,
      missingAnalyticsRows: input.analyticsReconciliation.missingStableKeys.length,
    }),
    content: output('content'),
    dailySnapshots: output('dailySnapshots'),
    accounts: output('accounts'),
    tables: Object.freeze(summaries),
    checkpointSaved: input.checkpointSaved,
    resumableWork: Object.freeze({
      resumed: input.workResumed,
      complete: true,
      cleared: true,
    }),
  });
}

function planCount(value) {
  if (Array.isArray(value)) return value.length;
  const numeric = Number(value ?? 0);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function createAnalyticsReconciliation(input = {}) {
  return Object.freeze({
    enabled: true,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    observedStableKeys: Number(input.observedStableKeys ?? 0),
    previouslyObservedStableKeys: Number(input.previouslyObservedStableKeys ?? 0),
    expectedVideoCount: Number(input.expectedVideoCount ?? 0),
    queriedVideoCount: Number(input.queriedVideoCount ?? 0),
    scopeComplete: input.scopeComplete === true,
    missingStableKeys: Object.freeze([...(input.missingStableKeys ?? [])]),
    policy: 'retain_prior_row_emit_reconciliation_warning',
  });
}

function emptyAnalyticsReconciliation() {
  return Object.freeze({
    enabled: false,
    startDate: null,
    endDate: null,
    observedStableKeys: 0,
    previouslyObservedStableKeys: 0,
    expectedVideoCount: 0,
    queriedVideoCount: 0,
    scopeComplete: true,
    missingStableKeys: Object.freeze([]),
    policy: 'not_enabled',
  });
}

function emptyAnalyticsLoad() {
  return Object.freeze({
    rows: Object.freeze([]),
    completeness: Object.freeze({
      status: 'not_enabled',
      complete: true,
      totalTrackedVideos: 0,
      selectedVideos: 0,
      successfullyQueriedVideos: 0,
      skippedVideos: 0,
      failedVideos: 0,
      pagesProcessed: 0,
      chunksProcessed: 0,
      totalChunks: 0,
      resumedPages: 0,
      resumedChunks: 0,
    }),
  });
}

async function visitWorkUnits(input) {
  const visit = typeof input.visit === 'function' ? input.visit : () => undefined;
  let afterSequence = 0;
  for (let page = 1; page <= WORK_UNIT_MAX_PAGES; page += 1) {
    const result = await input.workStore.listPhaseUnits({
      workKey: input.workKey,
      phase: input.phase,
      afterSequence,
      limit: WORK_UNIT_READ_LIMIT,
    });
    const pageUnits = requireArray(result?.units, 'resumable work units');
    for (const unit of pageUnits) await visit(unit);
    if (result?.nextSequence === null || result?.nextSequence === undefined) {
      return;
    }
    const nextSequence = nonNegativeInteger(result.nextSequence, 'nextSequence');
    if (nextSequence <= afterSequence) {
      throw transientError('Resumable work unit pagination did not advance', {
        code: 'D1_SYNC_WORK_PAGINATION_STALLED',
        details: { phase: input.phase, page },
      });
    }
    afterSequence = nextSequence;
  }
  throw transientError('Resumable work unit pagination exceeded max pages', {
    code: 'D1_SYNC_WORK_PAGINATION_LIMIT',
    details: { phase: input.phase, maxPages: WORK_UNIT_MAX_PAGES },
  });
}

function analyticsFailureDetails(progress, totalTrackedVideos, totalChunks) {
  const successfullyQueriedVideos = Number(progress?.processedItems ?? 0);
  return {
    analyticsCompleteness: {
      status: 'partial',
      complete: false,
      totalTrackedVideos,
      selectedVideos: totalTrackedVideos,
      successfullyQueriedVideos,
      skippedVideos: 0,
      failedVideos: Math.max(0, totalTrackedVideos - successfullyQueriedVideos),
      pagesProcessed: Number(progress?.pagesProcessed ?? 0),
      chunksProcessed: Number(progress?.chunksProcessed ?? 0),
      totalChunks,
    },
  };
}

function analyticsProgressError(error, progress, totalTrackedVideos, totalChunks) {
  const factory = error?.retryable === true ? transientError : permanentError;
  const errorDetails = error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details
    : {};
  return factory(error instanceof Error ? error.message : 'YouTube Analytics query failed', {
    code: error?.code ?? 'YOUTUBE_ANALYTICS_QUERY_FAILED',
    cause: error,
    details: {
      ...errorDetails,
      ...analyticsFailureDetails(progress, totalTrackedVideos, totalChunks),
    },
  });
}

function enumerateDateOnlyRange(startDate, endDate) {
  const start = requireDateOnly(startDate, { label: 'analyticsStartDate' });
  const end = requireDateOnly(endDate, { label: 'analyticsEndDate' });
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (endMs < startMs) throw new RangeError('analyticsEndDate must not be before analyticsStartDate');
  const dates = [];
  for (let instant = startMs; instant <= endMs; instant += 86_400_000) {
    dates.push(new Date(instant).toISOString().slice(0, 10));
  }
  return Object.freeze(dates);
}

async function normalizeExistingRecords(input) {
  if (input.records.length === 0 || typeof input.repository.prepareExistingRecords !== 'function') {
    return input.records;
  }
  return input.repository.prepareExistingRecords(input.tableId, input.records, {
    incomingFieldNames: input.fieldNames,
  });
}

function readSafeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function requireRepository(value) {
  for (const method of ['prepareRows', 'createMany', 'updateMany', 'listByFieldValues']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires repository.${method}`);
  return value;
}
function requireSyncEngine(value) {
  for (const method of ['planByKey', 'executePlan']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires syncEngine.${method}`);
  return value;
}
function requireYouTubeClient(value, fieldName) {
  for (const method of ['getChannel', 'listUploadVideoIdsPage', 'listVideos']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires ${fieldName}.${method}`);
  return value;
}
function requireStateStore(value) {
  for (const method of ['loadCheckpoint', 'saveCheckpoint']) if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires incrementalStateStore.${method}`);
  return value;
}
function requireWorkStore(value) {
  for (const method of [
    'beginWork',
    'assertCurrentGeneration',
    'loadPhase',
    'savePhase',
    'listPhaseUnits',
    'resetPhase',
    'saveWarningOutbox',
    'listPendingWarnings',
    'completeWork',
    'cleanupExpiredWork',
  ]) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`YouTube sync requires resumableWorkStore.${method}`);
  }
  return value;
}
function requireTables(value) {
  const keys = ['mktAccounts', 'mktContent', 'mktContentDaily'];
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, requireText(value?.[key], `tables.${key}`)])));
}
function requireHistoryGateway(value) {
  if (typeof value?.listOrganicContentStatesByKeys !== 'function') {
    throw new TypeError('YouTube sync requires historyGateway.listOrganicContentStatesByKeys');
  }
  return value;
}
function requireAnalyticsStore(value) {
  if (typeof value?.listStableKeysByScope !== 'function') {
    throw new TypeError('YouTube sync requires analyticsStore.listStableKeysByScope');
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`YouTube sync requires ${fieldName}`);
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function safeTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('timestamp must be epoch milliseconds');
  return number;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
function readOptionalPositiveInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, fieldName);
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function uniqueTextValues(values, fieldName) {
  return [...new Set(requireArray(values, fieldName).map((value) => requireText(value, fieldName)))];
}
function dedupeBy(values, readKey) {
  return [...new Map(values.map((value) => [readKey(value), value])).values()];
}
