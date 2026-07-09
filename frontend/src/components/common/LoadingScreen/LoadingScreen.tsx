import styles from './LoadingScreen.module.scss';

function LoadingScreen(props: { label?: string; class?: string }) {
  return (
    <div
      class={`${styles.loadingScreen} ${props.class ?? ''}`}
      role="status"
      aria-label={props.label ?? 'Загрузка'}
    >
      <span class={styles.spinner} aria-hidden="true" />
    </div>
  );
}

export default LoadingScreen;
