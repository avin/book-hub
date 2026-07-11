import { useContext } from 'solid-js';
import { PageLockerContext } from './PageLockerProvider';

function usePageLocker() {
  const pageLocker = useContext(PageLockerContext);

  if (!pageLocker) {
    throw new Error('usePageLocker must be used inside PageLockerProvider');
  }

  return pageLocker;
}

export default usePageLocker;
