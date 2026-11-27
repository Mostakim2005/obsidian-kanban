import { moment } from 'obsidian';
import type { StateManager } from 'src/StateManager';

import { english as en } from './flatpickr/l10n/default';
import { CustomLocale } from './flatpickr/types/locale';

interface KanbanFlatpickrGlobals {
  __kanbanFlatpickrLocale?: CustomLocale | null;
}

export function setActiveFlatpickrLocale(locale: CustomLocale | null): void {
  (window as unknown as KanbanFlatpickrGlobals).__kanbanFlatpickrLocale = locale;
}

export function getDefaultLocale(stateManager?: StateManager) {
  const firstDayOfWeek = stateManager?.getSetting('date-picker-week-start');
  const activeLocale = (window as unknown as KanbanFlatpickrGlobals).__kanbanFlatpickrLocale;
  const curLocale = (moment.locale() !== 'en' && activeLocale) || en;

  if (firstDayOfWeek) {
    return {
      ...curLocale,
      firstDayOfWeek,
    };
  }

  return curLocale;
}
