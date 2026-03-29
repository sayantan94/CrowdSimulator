import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue')
  },
  {
    path: '/auth/callback',
    name: 'auth-callback',
    component: () => import('../views/AuthCallbackView.vue')
  },
  {
    path: '/',
    name: 'compose',
    component: () => import('../views/ComposeView.vue')
  },
  {
    path: '/research/:id',
    name: 'research',
    component: () => import('../views/ResearchView.vue')
  },
  {
    path: '/simulate/:id',
    name: 'simulate',
    component: () => import('../views/SimulateView.vue')
  },
  {
    path: '/results/:id',
    name: 'results',
    component: () => import('../views/ResultsView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const { isAuthenticated } = useAuth()

  const publicRoutes = ['login', 'auth-callback']
  if (!publicRoutes.includes(to.name) && !isAuthenticated.value) {
    return { name: 'login' }
  }
})

export default router
