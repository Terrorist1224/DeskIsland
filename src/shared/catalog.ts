import definitions from './widget-catalog.json';
import type { WidgetDefinition, WidgetType } from './contracts';

export const widgetCatalog = definitions as WidgetDefinition[];

export function isWidgetType(value: unknown): value is WidgetType {
  return widgetCatalog.some((definition) => definition.typeId === value);
}

export function getWidgetDefinition(typeId: WidgetType): WidgetDefinition {
  const definition = widgetCatalog.find((item) => item.typeId === typeId);
  if (!definition) throw new Error(`Unknown widget type: ${typeId}`);
  return definition;
}
