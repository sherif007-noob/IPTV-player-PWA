import { useEffect, useCallback } from 'react';
import { WEBOS_KEYS } from '../types';
import { navigateSpatial } from '../utils/spatialNav';

interface RemoteHandlers {
  onBack?: () => void;
  onEnter?: () => void;
  onArrowLeft?: (e: KeyboardEvent) => void;
  onArrowRight?: (e: KeyboardEvent) => void;
  onArrowUp?: (e: KeyboardEvent) => void;
  onArrowDown?: (e: KeyboardEvent) => void;
  onPlayPause?: () => void;
  onFastForward?: () => void;
  onRewind?: () => void;
  onColorRed?: () => void;
  onColorGreen?: () => void;
  onColorYellow?: () => void;
  onColorBlue?: () => void;
}

export function useWebOSRemote(handlers: RemoteHandlers, isPlayerActive: boolean = false) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Player and dialogs own their keys; never run two handlers for one action.
      if (isPlayerActive || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      // Don't intercept if typing in an input field (e.g. search or login)
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      const keyCode = e.keyCode || e.which;

      // LG webOS Back key (461) or standard Escape (27) or Smart TV Back keys
      const isBackKey =
        keyCode === WEBOS_KEYS.BACK ||
        keyCode === 461 ||
        keyCode === 27 ||
        keyCode === 10009 ||
        keyCode === 4 ||
        e.key === 'Back' ||
        e.key === 'GoBack' ||
        e.key === 'Escape' ||
        e.key === 'BrowserBack' ||
        e.key === 'XF86Back' ||
        e.code === 'BrowserBack' ||
        e.code === 'Escape';

      if (isBackKey) {
        e.preventDefault();
        e.stopPropagation();
        if (isInput) {
          target?.blur();
        }
        if (handlers.onBack) {
          handlers.onBack();
        }
        return;
      }

      // If user is currently focused on an input, let them type
      if (isInput) {
        if (keyCode === WEBOS_KEYS.ENTER && handlers.onEnter) {
          handlers.onEnter();
        }
        return;
      }

      // Remote Color Keys: Red, Green, Yellow, Blue
      const isRed =
        keyCode === WEBOS_KEYS.RED ||
        keyCode === 403 ||
        keyCode === 10008 ||
        e.key === 'ColorF0Red' ||
        e.key === 'Red' ||
        e.code === 'ColorF0Red';

      const isGreen =
        keyCode === WEBOS_KEYS.GREEN ||
        keyCode === 404 ||
        keyCode === 10007 ||
        e.key === 'ColorF1Green' ||
        e.key === 'Green' ||
        e.code === 'ColorF1Green';

      const isYellow =
        keyCode === WEBOS_KEYS.YELLOW ||
        keyCode === 405 ||
        keyCode === 10006 ||
        e.key === 'ColorF2Yellow' ||
        e.key === 'Yellow' ||
        e.code === 'ColorF2Yellow';

      const isBlue =
        keyCode === WEBOS_KEYS.BLUE ||
        keyCode === 406 ||
        keyCode === 10005 ||
        e.key === 'ColorF3Blue' ||
        e.key === 'Blue' ||
        e.code === 'ColorF3Blue';

      if (isRed && handlers.onColorRed) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onColorRed();
        return;
      }

      if (isGreen && handlers.onColorGreen) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onColorGreen();
        return;
      }

      if (isYellow && handlers.onColorYellow) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onColorYellow();
        return;
      }

      if (isBlue && handlers.onColorBlue) {
        e.preventDefault();
        e.stopPropagation();
        handlers.onColorBlue();
        return;
      }

      switch (keyCode) {
        case WEBOS_KEYS.ENTER:
          if (handlers.onEnter) {
            e.preventDefault();
            handlers.onEnter();
          } else if (target && typeof (target as any).click === 'function') {
            // Native button/element trigger
          }
          break;

        case WEBOS_KEYS.LEFT:
          if (handlers.onArrowLeft) {
            e.preventDefault();
            handlers.onArrowLeft(e);
          } else if (!isPlayerActive) {
            e.preventDefault();
            navigateSpatial('left');
          }
          break;

        case WEBOS_KEYS.RIGHT:
          if (handlers.onArrowRight) {
            e.preventDefault();
            handlers.onArrowRight(e);
          } else if (!isPlayerActive) {
            e.preventDefault();
            navigateSpatial('right');
          }
          break;

        case WEBOS_KEYS.UP:
          if (handlers.onArrowUp) {
            e.preventDefault();
            handlers.onArrowUp(e);
          } else if (!isPlayerActive) {
            e.preventDefault();
            navigateSpatial('up');
          }
          break;

        case WEBOS_KEYS.DOWN:
          if (handlers.onArrowDown) {
            e.preventDefault();
            handlers.onArrowDown(e);
          } else if (!isPlayerActive) {
            e.preventDefault();
            navigateSpatial('down');
          }
          break;

        // Play / Pause keys
        case WEBOS_KEYS.PLAY:
        case WEBOS_KEYS.PAUSE:
        case 32: // Spacebar
          if (handlers.onPlayPause) {
            e.preventDefault();
            handlers.onPlayPause();
          }
          break;

        case WEBOS_KEYS.FAST_FORWARD:
          if (handlers.onFastForward) {
            e.preventDefault();
            handlers.onFastForward();
          }
          break;

        case WEBOS_KEYS.REWIND:
          if (handlers.onRewind) {
            e.preventDefault();
            handlers.onRewind();
          }
          break;

        // Remote Color Keys
        case WEBOS_KEYS.RED:
          if (handlers.onColorRed) {
            e.preventDefault();
            handlers.onColorRed();
          }
          break;

        case WEBOS_KEYS.GREEN:
          if (handlers.onColorGreen) {
            e.preventDefault();
            handlers.onColorGreen();
          }
          break;

        case WEBOS_KEYS.YELLOW:
          if (handlers.onColorYellow) {
            e.preventDefault();
            handlers.onColorYellow();
          }
          break;

        case WEBOS_KEYS.BLUE:
          if (handlers.onColorBlue) {
            e.preventDefault();
            handlers.onColorBlue();
          }
          break;

        default:
          break;
      }
    },
    [handlers, isPlayerActive]
  );

  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      const keyCode = e.keyCode || e.which;
      if (
        keyCode === 461 ||
        keyCode === 27 ||
        keyCode === 10009 ||
        keyCode === 4 ||
        e.key === 'Back' ||
        e.key === 'GoBack' ||
        e.key === 'Escape' ||
        e.key === 'BrowserBack' ||
        e.key === 'XF86Back' ||
        e.code === 'BrowserBack' ||
        e.code === 'Escape'
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
    };
  }, [handleKeyDown]);
}
