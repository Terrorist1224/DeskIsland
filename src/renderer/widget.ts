import { createApp } from 'vue';
import WidgetView from './WidgetView.vue';

const widgetId = new URLSearchParams(location.search).get('id');
if (!widgetId) throw new Error('Missing widget id');

createApp(WidgetView, { widgetId }).mount('#app');
