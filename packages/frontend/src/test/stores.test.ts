import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../store/authStore';
import { useAppStore } from '../store/appStore';
import { usePreferencesStore } from '../store/preferencesStore';

// Reset store state between tests
beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, user: null, token: null });
  useAppStore.setState({
    sidebarOpen: false,
    notifications: [],
    globalLoading: false,
    activeModal: null,
  });
  usePreferencesStore.setState({
    theme: 'system',
    language: 'en',
    currency: 'XLM',
    dataRefreshInterval: 30,
    enableAnimations: true,
    enableRealtimeUpdates: true,
    enableNotifications: true,
    analyticsEnabled: true,
  } as any);
});

// ── Auth Store ────────────────────────────────────────────────────────────────

describe('useAuthStore', () => {
  it('starts unauthenticated', () => {
    const { isAuthenticated, user, token } = useAuthStore.getState();
    expect(isAuthenticated).toBe(false);
    expect(user).toBeNull();
    expect(token).toBeNull();
  });

  it('login sets authenticated state', async () => {
    await useAuthStore.getState().login('test@example.com', 'password');
    const { isAuthenticated, user, token } = useAuthStore.getState();
    expect(isAuthenticated).toBe(true);
    expect(user?.email).toBe('test@example.com');
    expect(token).toBeTruthy();
  });

  it('logout clears auth state', async () => {
    await useAuthStore.getState().login('test@example.com', 'password');
    useAuthStore.getState().logout();
    const { isAuthenticated, user, token } = useAuthStore.getState();
    expect(isAuthenticated).toBe(false);
    expect(user).toBeNull();
    expect(token).toBeNull();
  });

  it('setUser sets user and marks authenticated', () => {
    const mockUser = { id: '1', email: 'a@b.com', name: 'Alice' };
    useAuthStore.getState().setUser(mockUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(mockUser);
  });

  it('clearAuth resets all auth state', async () => {
    await useAuthStore.getState().login('test@example.com', 'password');
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});

// ── App Store ─────────────────────────────────────────────────────────────────

describe('useAppStore', () => {
  it('toggleSidebar flips sidebarOpen', () => {
    expect(useAppStore.getState().sidebarOpen).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(false);
  });

  it('addNotification adds to list', () => {
    useAppStore.getState().addNotification({ type: 'info', title: 'Test' });
    const { notifications } = useAppStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Test');
    expect(notifications[0].read).toBe(false);
  });

  it('removeNotification removes by id', () => {
    useAppStore.getState().addNotification({ type: 'info', title: 'Test' });
    const id = useAppStore.getState().notifications[0].id;
    useAppStore.getState().removeNotification(id);
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it('markNotificationRead marks as read', () => {
    useAppStore.getState().addNotification({ type: 'info', title: 'Test' });
    const id = useAppStore.getState().notifications[0].id;
    useAppStore.getState().markNotificationRead(id);
    expect(useAppStore.getState().notifications[0].read).toBe(true);
  });

  it('clearNotifications empties the list', () => {
    useAppStore.getState().addNotification({ type: 'info', title: 'A' });
    useAppStore.getState().addNotification({ type: 'error', title: 'B' });
    useAppStore.getState().clearNotifications();
    expect(useAppStore.getState().notifications).toHaveLength(0);
  });

  it('openModal / closeModal manage activeModal', () => {
    useAppStore.getState().openModal('confirm-delete');
    expect(useAppStore.getState().activeModal).toBe('confirm-delete');
    useAppStore.getState().closeModal();
    expect(useAppStore.getState().activeModal).toBeNull();
  });

  it('setGlobalLoading updates loading state', () => {
    useAppStore.getState().setGlobalLoading(true);
    expect(useAppStore.getState().globalLoading).toBe(true);
    useAppStore.getState().setGlobalLoading(false);
    expect(useAppStore.getState().globalLoading).toBe(false);
  });

  it('caps notifications at 50', () => {
    for (let i = 0; i < 55; i++) {
      useAppStore.getState().addNotification({ type: 'info', title: `N${i}` });
    }
    expect(useAppStore.getState().notifications.length).toBeLessThanOrEqual(50);
  });
});

// ── Preferences Store ─────────────────────────────────────────────────────────

describe('usePreferencesStore', () => {
  it('setTheme updates theme', () => {
    usePreferencesStore.getState().setTheme('dark');
    expect(usePreferencesStore.getState().theme).toBe('dark');
  });

  it('setCurrency updates currency', () => {
    usePreferencesStore.getState().setCurrency('USD');
    expect(usePreferencesStore.getState().currency).toBe('USD');
  });

  it('setDataRefreshInterval updates interval', () => {
    usePreferencesStore.getState().setDataRefreshInterval(60);
    expect(usePreferencesStore.getState().dataRefreshInterval).toBe(60);
  });

  it('setLanguage updates language', () => {
    usePreferencesStore.getState().setLanguage('fr');
    expect(usePreferencesStore.getState().language).toBe('fr');
  });

  it('setTimezone updates timezone', () => {
    usePreferencesStore.getState().setTimezone('local');
    expect(usePreferencesStore.getState().timezone).toBe('local');
  });

  it('setFontSize updates fontSize', () => {
    usePreferencesStore.getState().setFontSize('large');
    expect(usePreferencesStore.getState().fontSize).toBe('large');
  });

  it('setReducedMotion updates reducedMotion', () => {
    usePreferencesStore.getState().setReducedMotion(true);
    expect(usePreferencesStore.getState().reducedMotion).toBe(true);
  });

  it('setHighContrast updates highContrast', () => {
    usePreferencesStore.getState().setHighContrast(true);
    expect(usePreferencesStore.getState().highContrast).toBe(true);
  });

  it('setEnableNotifications updates enableNotifications', () => {
    usePreferencesStore.getState().setEnableNotifications(false);
    expect(usePreferencesStore.getState().enableNotifications).toBe(false);
  });

  it('setEnableAnimations updates enableAnimations', () => {
    usePreferencesStore.getState().setEnableAnimations(false);
    expect(usePreferencesStore.getState().enableAnimations).toBe(false);
  });

  it('setEnableRealtimeUpdates updates enableRealtimeUpdates', () => {
    usePreferencesStore.getState().setEnableRealtimeUpdates(false);
    expect(usePreferencesStore.getState().enableRealtimeUpdates).toBe(false);
  });

  it('setAnalyticsEnabled updates analyticsEnabled', () => {
    usePreferencesStore.getState().setAnalyticsEnabled(false);
    expect(usePreferencesStore.getState().analyticsEnabled).toBe(false);
  });

  it('resetPreferences restores defaults', () => {
    usePreferencesStore.getState().setTheme('dark');
    usePreferencesStore.getState().setCurrency('EUR');
    usePreferencesStore.getState().resetPreferences();
    expect(usePreferencesStore.getState().theme).toBe('system');
    expect(usePreferencesStore.getState().currency).toBe('XLM');
  });
});
