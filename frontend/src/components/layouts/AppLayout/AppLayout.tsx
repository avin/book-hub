import { A, useNavigate } from '@solidjs/router';
import { createSignal, type JSX } from 'solid-js';
import { BookOpen, ChevronDown, Library, LogOut, Settings, Upload } from 'lucide-solid';
import { createLogoutMutation } from '@/api/auth';
import Button from '@/components/common/Button/Button';
import LanguageSelect from '@/components/common/LanguageSelect/LanguageSelect';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './AppLayout.module.scss';

function AppLayout(props: { children: JSX.Element }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const logoutMutation = createLogoutMutation();
  const [sidebarPanelOpen, setSidebarPanelOpen] = createSignal(false);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        navigate('/login', { replace: true });
      },
    });
  };

  return (
    <div class={styles.layout}>
      <aside class={styles.sidebar}>
        <div class={styles.sidebarTop}>
          <div class={styles.sidebarHeader}>
            <A href="/library" class={styles.brand}>
              <BookOpen />
              <span>{t('bookHub')}</span>
            </A>
          </div>

          <nav class={styles.nav}>
            <A href="/library" class={styles.libraryNavLink}>
              <Library />
              <span class={styles.navLabel}>{t('library')}</span>
            </A>
            <A
              href="/upload"
              class={styles.iconNavLink}
              aria-label={t('upload')}
              title={t('upload')}
            >
              <Upload />
              <span class={styles.navLabel}>{t('upload')}</span>
            </A>
            <A
              href="/settings"
              class={styles.iconNavLink}
              aria-label={t('settings')}
              title={t('settings')}
            >
              <Settings />
              <span class={styles.navLabel}>{t('settings')}</span>
            </A>
          </nav>

          <Button
            class={styles.mobilePanelToggle}
            classList={{ [styles.mobilePanelToggleOpen]: sidebarPanelOpen() }}
            type="button"
            variant="ghost"
            iconOnly
            iconStart={<ChevronDown />}
            aria-label={t('accountMenu')}
            aria-controls="app-layout-mobile-panel"
            aria-expanded={sidebarPanelOpen()}
            title={t('accountMenu')}
            onClick={() => setSidebarPanelOpen((open) => !open)}
          />
        </div>

        <div
          id="app-layout-mobile-panel"
          class={styles.sidebarPanel}
          classList={{ [styles.sidebarPanelOpen]: sidebarPanelOpen() }}
        >
          <div class={styles.sidebarActions}>
            <LanguageSelect fullWidth placement="top-start" />
          </div>

          <div class={styles.sidebarFooter}>
            <Button
              class={styles.logoutButton}
              fullWidth
              type="button"
              variant="ghost"
              loading={logoutMutation.isPending}
              iconStart={<LogOut />}
              onClick={handleLogout}
            >
              {t('signOut')}
            </Button>
          </div>
        </div>
      </aside>
      <main class={styles.content}>{props.children}</main>
    </div>
  );
}

export default AppLayout;
