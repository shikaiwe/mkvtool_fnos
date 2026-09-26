import { createRouter, createWebHashHistory } from 'vue-router'

// hash 路由：避免网关前缀与服务器端路由的兼容问题
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/jobs' },
    { path: '/jobs', component: () => import('./pages/JobsPage.vue') },
    { path: '/muxer', component: () => import('./pages/MuxerPage.vue') },
    { path: '/extract', component: () => import('./pages/ExtractPage.vue') },
    { path: '/propedit', component: () => import('./pages/PropEditPage.vue') },
    { path: '/info', component: () => import('./pages/InfoPage.vue') },
    { path: '/chapters', component: () => import('./pages/ChaptersPage.vue') },
    { path: '/logs', component: () => import('./pages/LogPage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/about', component: () => import('./pages/AboutPage.vue') },
  ],
})
