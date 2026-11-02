// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { usePageStore } from './page.store';
import { resolveDataPath, DATA_BINDING_TARGETS } from './graphic-defaults';
import { showAlert } from '../utils/messageBox';

/** Data binding - bind data
 *
 * v3.1: No longer modify the graphic.dataSource config fields (enabled / dataSource / dataField).
 * Those fields are managed centrally by DataPanel.onDataSourceSelected; BindingManager only handles WS tag subscriptions.
 */
export function bindDataHelper(graphicId: string, _dataSource: string, _dataField: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    // Only mark the page dirty; do not modify the graphic.dataSource config fields
    currentPage.markDirty?.();
  }
}

/** Data binding - unbind
 *
 * v3.1: No longer reset the graphic.dataSource config fields (enabled / dataSource / dataField).
 * Those fields are managed centrally by DataPanel.onDataSourceSelected; BindingManager only handles WS tag subscriptions.
 */
export function unbindDataHelper(_graphicId: string) {
  // Only manage BindingManager internal state; do not modify the graphic.dataSource config fields
}

/** Data binding - apply data */
export function applyDataHelper(data: Record<string, any>) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  currentPage.graphics.forEach((graphic) => {
    if (graphic.dataSource?.enabled && graphic.dataSource?.dataField) {
      const value = resolveDataPath(data, graphic.dataSource.dataField);
      if (value !== null && value !== undefined) {
        const targetProp = DATA_BINDING_TARGETS[graphic.type];
        if (targetProp && graphic.config.customProps) {
          graphic.config.customProps[targetProp] = value;
          currentPage.updateGraphic(graphic.id, { config: { ...graphic.config } });
        }
      }
    }
  });
}

/** Event interaction - add event */
export function addEventHandlerHelper(graphicId: string, eventType: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    if (!graphic.events) {
      graphic.events = {
        eventHandlers: {},
        type: '',
        payload: {},
        timestamp: Date.now(),
      };
    }
    if (!graphic.events.eventHandlers) {
      graphic.events.eventHandlers = {};
    }
    graphic.events.eventHandlers[eventType] = {
      id: crypto.randomUUID(),
      eventType,
      actions: [],
    };
    currentPage.markDirty?.();
  }
}

/** Event interaction - remove event */
export function removeEventHandlerHelper(graphicId: string, eventId: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    if (graphic.events.eventHandlers) {
      delete graphic.events.eventHandlers[eventId];
      currentPage.markDirty?.();
    }
  }
}

/** Event interaction - add action */
export function addActionHelper(graphicId: string, eventId: string, actionType: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic?.events.eventHandlers[eventId]) {
    const event = graphic.events.eventHandlers[eventId];
    if (event) {
      event.actions.push({
        id: crypto.randomUUID(),
        actionType,
        target: '',
        value: '',
        conditions: [],
      });
      currentPage.markDirty?.();
    }
  }
}

/** Event interaction - remove action */
export function removeActionHelper(graphicId: string, eventId: string, actionId: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    const event = graphic.events.eventHandlers[eventId];
    if (event) {
      event.actions = event.actions.filter((a) => a.id !== actionId);
      currentPage.markDirty?.();
    }
  }
}

/** Event interaction - execute action */
export function executeActionHelper(action: any, _graphicId?: string, _eventData?: any) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  switch (action.actionType) {
    case 'show':
      // Show the target graphic
      if (action.target) {
        const targetGraphic = currentPage.graphics.find(
          (g) => g.id === action.target
        );
        if (targetGraphic) {
          targetGraphic.config.visible = true;
          currentPage.markDirty?.();
        }
      }
      break;
    case 'hide':
      // Hide the target graphic
      if (action.target) {
        const targetGraphic = currentPage.graphics.find(
          (g) => g.id === action.target
        );
        if (targetGraphic) {
          targetGraphic.config.visible = false;
          currentPage.markDirty?.();
        }
      }
      break;
    case 'change':
      // Change the target graphic's property
      if (action.target) {
        const targetGraphic = currentPage.graphics.find(
          (g) => g.id === action.target
        );
        if (targetGraphic) {
          try {
            const propertyPath = action.target.split('.');
            let target = targetGraphic;

            for (let i = 0; i < propertyPath.length - 1; i++) {
              if (
                target.config.customProps[propertyPath[i]] !== undefined
              ) {
                target = target.config.customProps[propertyPath[i]];
              } else {
                return;
              }
            }

            const propertyName = propertyPath[propertyPath.length - 1];
            target.config.customProps[propertyName] = action.value;
            currentPage.markDirty?.();
          } catch (error) {
            console.error('Error changing property:', error);
          }
        }
      }
      break;
    case 'navigate':
      // Navigate to the specified URL
      if (action.value) {
        window.location.href = action.value;
      }
      break;
    case 'alert':
      // Show a notification
      if (action.value) {
        showAlert(action.value);
      }
      break;
  }
}

/** Event interaction - trigger event */
export function triggerEventHandlerHelper(graphicId: string, eventType: string, eventData?: any) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic?.events.eventHandlers?.[eventType]) {
    const event = graphic.events.eventHandlers[eventType];
    if (event) {
      event.actions.forEach((action) => {
        // Check whether conditions are met
        const conditionsMet = action.conditions.every((condition) => {
          let fieldValue = eventData;
          const fieldPath = condition.field.split('.');

          for (const key of fieldPath) {
            if (fieldValue[key] !== undefined) {
              fieldValue = fieldValue[key];
            } else {
              return false;
            }
          }

          // Evaluate the condition
          switch (condition.operator) {
            case 'equal':
              return fieldValue === condition.value;
            case 'notEqual':
              return fieldValue !== condition.value;
            case 'greaterThan':
              return fieldValue > condition.value;
            case 'lessThan':
              return fieldValue < condition.value;
            case 'greaterThanOrEqual':
              return fieldValue >= condition.value;
            case 'lessThanOrEqual':
              return fieldValue <= condition.value;
            case 'contains':
              return fieldValue.includes(condition.value);
            case 'notContains':
              return !fieldValue.includes(condition.value);
            default:
              return true;
          }
        });

        if (conditionsMet) {
          // Execute the action
          executeActionHelper(action, graphicId, eventData);
        }
      });
    }
  }
}

/** Animation effects - add animation */
export function addAnimationHelper(graphicId: string, animation: any) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    if (!graphic.config.customProps.animations) {
      graphic.config.customProps.animations = [];
    }
    graphic.config.customProps.animations.push(animation);
    currentPage.markDirty?.();
  }
}

/** Animation effects - remove animation */
export function removeAnimationHelper(graphicId: string, animationIndex: number) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic && graphic.config.customProps.animations) {
    graphic.config.customProps.animations.splice(animationIndex, 1);
    currentPage.markDirty?.();
  }
}
