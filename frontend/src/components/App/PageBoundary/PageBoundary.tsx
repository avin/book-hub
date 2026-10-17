import { ErrorBoundary, type JSX, Suspense } from 'solid-js';
import Button from '@/components/common/Button/Button';
import LoadingScreen from '@/components/common/LoadingScreen/LoadingScreen';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './PageBoundary.module.scss';

function isChunkLoadError(error: unknown) {
  return (
    error instanceof TypeError &&
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      error.message,
    )
  );
}

function PageBoundary(props: { children: JSX.Element }) {
  const { t } = useI18n();

  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        console.error(error);

        return (
          <div class={styles.pageError} role="alert">
            <p>{t('pageFailedToLoad')}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}
            >
              {t('tryAgain')}
            </Button>
          </div>
        );
      }}
    >
      <Suspense fallback={<LoadingScreen label={t('loading')} />}>{props.children}</Suspense>
    </ErrorBoundary>
  );
}

export default PageBoundary;
