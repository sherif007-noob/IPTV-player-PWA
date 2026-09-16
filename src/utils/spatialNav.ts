export type Direction = 'up' | 'down' | 'left' | 'right';

// Focusable targets exclusively for TV spatial navigation:
// Covers Header Navigation Tabs, Sidebar Categories, Stream Cards in Live TV / Movies / Series grids,
// Home Portal library cards & shortcuts, Details Modal controls, and Video Player overlays.
// Explicitly EXCLUDES search text inputs, refresh, text size, and settings buttons.
export const FOCUSABLE_SELECTOR = `
  #btn-header-home,
  #header-tab-live,
  #header-tab-vod,
  #header-tab-series,
  [id^="category-item-"],
  [id^="stream-card-"],
  [id^="card-portal-"],
  [id^="btn-portal-"],
  [id^="card-jump-back-"],
  [id^="btn-jump-back-"],
  [id^="btn-clear-portal-"],
  #btn-details-back,
  #btn-details-fav,
  #btn-details-watchlist,
  #btn-resume-series-progress,
  #btn-play-series-next,
  #btn-resume-playback,
  #btn-play-beginning,
  #btn-play-first-episode,
  [id^="tab-season-"],
  [id^="episode-card-"],
  [id^="btn-season-"],
  [id^="player-episode-"],
  [id^="btn-player-"],
  [id^="btn-in-player-"],
  [id^="drawer-ep-"],
  [id^="btn-drawer-"],
  [id^="btn-clear-active-special"]
`;

let lastHoveredElement: HTMLElement | null = null;

// Track pointer moves to sync activeElement between Mouse and D-pad seamlessly
if (typeof window !== 'undefined') {
  let lastMoveTime = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      const now = performance.now();
      if (now - lastMoveTime < 30) return; // 30ms throttle for TV CPU
      lastMoveTime = now;

      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(FOCUSABLE_SELECTOR);
      if (target && isElementVisible(target)) {
        lastHoveredElement = target;
        if (target !== document.activeElement) {
          target.focus({ preventScroll: true });
        }
      }
    },
    { passive: true }
  );
}

export function isElementVisible(el: HTMLElement): boolean {
  if (!el || el.offsetParent === null) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function navigateSpatial(direction: Direction): boolean {
  if (typeof document === 'undefined') return false;

  // 1. Determine active container boundary (Strict Modal / Drawer / Root Trapping)
  let rootSearch: ParentNode = document;
  const detailsModal = document.querySelector<HTMLElement>('#details-card-container');
  const inPlayerDrawer = document.querySelector<HTMLElement>('#in-player-episode-drawer');
  const settingsModal = document.querySelector<HTMLElement>('#settings-modal-container');

  if (detailsModal && isElementVisible(detailsModal)) {
    rootSearch = detailsModal;
  } else if (inPlayerDrawer && isElementVisible(inPlayerDrawer)) {
    rootSearch = inPlayerDrawer;
  } else if (settingsModal && isElementVisible(settingsModal)) {
    rootSearch = settingsModal;
  }

  // 2. Query candidates strictly within the active root container
  const allCandidates = Array.from(
    rootSearch.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => {
    // Explicitly reject inputs, search bars, and explicitly skipped elements
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return false;
    if (el.getAttribute('data-skip-spatial') === 'true') return false;
    return isElementVisible(el);
  });

  if (allCandidates.length === 0) return false;

  let currentEl = document.activeElement as HTMLElement | null;

  // If focus was lost or outside root container, sync with lastHoveredElement inside root
  if (
    (!currentEl || !rootSearch.contains(currentEl) || !allCandidates.includes(currentEl)) &&
    lastHoveredElement &&
    rootSearch.contains(lastHoveredElement) &&
    allCandidates.includes(lastHoveredElement) &&
    isElementVisible(lastHoveredElement)
  ) {
    currentEl = lastHoveredElement;
  }

  // If nothing is focused or focus is in header/body/background, intelligently pick starting element within root
  if (!currentEl || !rootSearch.contains(currentEl) || !allCandidates.includes(currentEl)) {
    // A. Details modal priority
    if (rootSearch === detailsModal && detailsModal) {
      const detailsPlay = detailsModal.querySelector<HTMLElement>(
        '#btn-resume-series-progress, #btn-play-series-next, #btn-resume-playback, #btn-play-beginning, #btn-play-first-episode, #btn-details-fav, #btn-details-back, [id^="episode-card-"]'
      );
      if (detailsPlay && isElementVisible(detailsPlay)) {
        detailsPlay.focus();
        detailsPlay.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
    }

    // B. Home portal
    const homeLiveCard = document.querySelector<HTMLElement>('#card-portal-live');
    if (homeLiveCard && isElementVisible(homeLiveCard)) {
      homeLiveCard.focus();
      return true;
    }

    // C. Active category or first stream card
    const activeCategory = document.querySelector<HTMLElement>(
      '[id^="category-item-"].bg-sky-500, [id^="category-item-"].bg-slate-800'
    );
    if (activeCategory && isElementVisible(activeCategory)) {
      activeCategory.focus();
      return true;
    }

    const firstCard = document.querySelector<HTMLElement>('[id^="stream-card-"]');
    if (firstCard && isElementVisible(firstCard)) {
      firstCard.focus();
      return true;
    }

    // Fallback to first candidate
    const first = allCandidates[0];
    if (first) {
      first.focus();
      first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
    return false;
  }

  const currentRect = currentEl.getBoundingClientRect();
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };

  const isCurrentSidebar = currentEl.id.startsWith('category-item-');
  const isCurrentStreamCard = currentEl.id.startsWith('stream-card-');
  const isCurrentEpisode = currentEl.id.startsWith('episode-card-');
  const isCurrentSeasonTab = currentEl.id.startsWith('tab-season-');
  const isCurrentDetailsAction =
    currentEl.id.startsWith('btn-details-') ||
    currentEl.id.startsWith('btn-resume-') ||
    currentEl.id.startsWith('btn-play-series-') ||
    currentEl.id.startsWith('btn-play-beginning');

  // --- Episode Cards Grid Navigation ---
  if (isCurrentEpisode) {
    const episodeCards = allCandidates.filter((c) => c.id.startsWith('episode-card-'));

    if (direction === 'left') {
      // Find cards in the same row or to the left
      const leftCards = episodeCards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.right < currentRect.left - 5;
      });
      if (leftCards.length > 0) {
        let best = leftCards[0];
        let minScore = Infinity;
        for (const card of leftCards) {
          const r = card.getBoundingClientRect();
          const dx = currentRect.left - r.right;
          const dy = Math.abs(r.top + r.height / 2 - currentCenter.y);
          const score = dx + dy * 5; // heavily prioritize same row
          if (score < minScore) {
            minScore = score;
            best = card;
          }
        }
        best.focus();
        lastHoveredElement = best;
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
      // On leftmost card of row: do NOT jump up to season tabs on left D-pad!
      return true;
    }

    if (direction === 'right') {
      // Find cards in the same row or to the right
      const rightCards = episodeCards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left > currentRect.right + 5;
      });
      if (rightCards.length > 0) {
        let best = rightCards[0];
        let minScore = Infinity;
        for (const card of rightCards) {
          const r = card.getBoundingClientRect();
          const dx = r.left - currentRect.right;
          const dy = Math.abs(r.top + r.height / 2 - currentCenter.y);
          const score = dx + dy * 5; // heavily prioritize same row
          if (score < minScore) {
            minScore = score;
            best = card;
          }
        }
        best.focus();
        lastHoveredElement = best;
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
      // On rightmost card of row: do NOT jump up to season tabs on right D-pad!
      return true;
    }

    if (direction === 'up') {
      // Look for episode cards directly above in the grid
      const aboveCards = episodeCards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.bottom < currentRect.top - 5;
      });
      if (aboveCards.length > 0) {
        let best = aboveCards[0];
        let minScore = Infinity;
        for (const card of aboveCards) {
          const r = card.getBoundingClientRect();
          const dy = currentRect.top - r.bottom;
          const dx = Math.abs(r.left + r.width / 2 - currentCenter.x);
          const score = dy + dx * 3;
          if (score < minScore) {
            minScore = score;
            best = card;
          }
        }
        best.focus();
        lastHoveredElement = best;
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }

      // If in top row of episodes, UP jumps to the active season tab or season tabs
      const seasonTabs = allCandidates.filter((c) => c.id.startsWith('tab-season-'));
      if (seasonTabs.length > 0) {
        let bestTab = seasonTabs[0];
        let minDx = Infinity;
        for (const tab of seasonTabs) {
          const r = tab.getBoundingClientRect();
          const dx = Math.abs(r.left + r.width / 2 - currentCenter.x);
          if (dx < minDx) {
            minDx = dx;
            bestTab = tab;
          }
        }
        bestTab.focus();
        lastHoveredElement = bestTab;
        bestTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
    }

    if (direction === 'down') {
      // Look for episode cards below
      const belowCards = episodeCards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top > currentRect.bottom + 5;
      });
      if (belowCards.length > 0) {
        let best = belowCards[0];
        let minScore = Infinity;
        for (const card of belowCards) {
          const r = card.getBoundingClientRect();
          const dy = r.top - currentRect.bottom;
          const dx = Math.abs(r.left + r.width / 2 - currentCenter.x);
          const score = dy + dx * 3;
          if (score < minScore) {
            minScore = score;
            best = card;
          }
        }
        best.focus();
        lastHoveredElement = best;
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
      return true;
    }
  }

  // --- Season Tabs Navigation ---
  if (isCurrentSeasonTab) {
    const seasonTabs = allCandidates.filter((c) => c.id.startsWith('tab-season-'));

    if (direction === 'left' || direction === 'right') {
      const horizontalTabs = seasonTabs.filter((t) => {
        const r = t.getBoundingClientRect();
        return direction === 'left' ? r.right < currentRect.left - 2 : r.left > currentRect.right + 2;
      });
      if (horizontalTabs.length > 0) {
        let best = horizontalTabs[0];
        let minDx = Infinity;
        for (const tab of horizontalTabs) {
          const r = tab.getBoundingClientRect();
          const dx = Math.abs(r.left - currentRect.left);
          if (dx < minDx) {
            minDx = dx;
            best = tab;
          }
        }
        best.focus();
        lastHoveredElement = best;
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
      return true;
    }

    if (direction === 'down') {
      // Jump to first visible episode card or the one closest in X
      const visibleEpisodes = allCandidates.filter((c) => c.id.startsWith('episode-card-'));
      if (visibleEpisodes.length > 0) {
        let bestEp = visibleEpisodes[0];
        let minDx = Infinity;
        for (const ep of visibleEpisodes) {
          const r = ep.getBoundingClientRect();
          const dx = Math.abs(r.left + r.width / 2 - currentCenter.x);
          if (dx < minDx) {
            minDx = dx;
            bestEp = ep;
          }
        }
        bestEp.focus();
        lastHoveredElement = bestEp;
        bestEp.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
    }

    if (direction === 'up') {
      // Jump to action buttons above
      const actions = allCandidates.filter((c) =>
        c.id.startsWith('btn-details-') ||
        c.id.startsWith('btn-resume-') ||
        c.id.startsWith('btn-play-series-')
      );
      if (actions.length > 0) {
        actions[0].focus();
        lastHoveredElement = actions[0];
        return true;
      }
    }
  }

  // --- Details Header Actions Navigation ---
  if (isCurrentDetailsAction && direction === 'down') {
    const seasonTabs = allCandidates.filter((c) => c.id.startsWith('tab-season-'));
    if (seasonTabs.length > 0) {
      const activeTab = seasonTabs.find((t) => t.classList.contains('bg-sky-500')) || seasonTabs[0];
      activeTab.focus();
      lastHoveredElement = activeTab;
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
  }

  // Special optimized handoff: Right from sidebar category jumps straight into visible stream cards
  if (isCurrentSidebar && direction === 'right') {
    const visibleCards = allCandidates.filter((c) => c.id.startsWith('stream-card-'));
    if (visibleCards.length > 0) {
      let closestCard = visibleCards[0];
      let minDy = Infinity;
      for (const card of visibleCards) {
        const r = card.getBoundingClientRect();
        const dy = Math.abs(r.top + r.height / 2 - currentCenter.y);
        if (dy < minDy) {
          minDy = dy;
          closestCard = card;
        }
      }
      closestCard.focus();
      lastHoveredElement = closestCard;
      closestCard.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
  }

  // Special optimized handoff: Left from leftmost stream card jumps straight back to active/closest category in sidebar
  if (isCurrentStreamCard && direction === 'left') {
    const cardsToLeft = allCandidates.filter(
      (c) => c.id.startsWith('stream-card-') && c.getBoundingClientRect().right < currentRect.left - 5
    );
    if (cardsToLeft.length === 0) {
      const visibleCats = allCandidates.filter((c) => c.id.startsWith('category-item-'));
      if (visibleCats.length > 0) {
        let closestCat = visibleCats[0];
        let minDy = Infinity;
        for (const cat of visibleCats) {
          const r = cat.getBoundingClientRect();
          const dy = Math.abs(r.top + r.height / 2 - currentCenter.y);
          if (dy < minDy) {
            minDy = dy;
            closestCat = cat;
          }
        }
        closestCat.focus();
        lastHoveredElement = closestCat;
        closestCat.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
    }
  }

  let bestCandidate: HTMLElement | null = null;
  let minScore = Infinity;

  for (const candidate of allCandidates) {
    if (candidate === currentEl) continue;

    const rect = candidate.getBoundingClientRect();
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    const dx = center.x - currentCenter.x;
    const dy = center.y - currentCenter.y;

    let isEligible = false;
    let primaryDist = 0;
    let orthogonalDist = 0;

    switch (direction) {
      case 'left':
        isEligible = dx < -5; // To the left
        primaryDist = Math.abs(dx);
        orthogonalDist = Math.abs(dy);
        break;
      case 'right':
        isEligible = dx > 5; // To the right
        primaryDist = Math.abs(dx);
        orthogonalDist = Math.abs(dy);
        break;
      case 'up':
        isEligible = dy < -5; // Above
        primaryDist = Math.abs(dy);
        orthogonalDist = Math.abs(dx);
        break;
      case 'down':
        isEligible = dy > 5; // Below
        primaryDist = Math.abs(dy);
        orthogonalDist = Math.abs(dx);
        break;
    }

    if (isEligible) {
      // Weight orthogonal distance heavier to prefer elements directly in line
      const score = primaryDist + orthogonalDist * 3.5;
      if (score < minScore) {
        minScore = score;
        bestCandidate = candidate;
      }
    }
  }

  if (bestCandidate) {
    bestCandidate.focus();
    lastHoveredElement = bestCandidate;
    bestCandidate.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  return false;
}
