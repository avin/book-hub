import { Download, Edit3, Eye, Heart, RotateCcw, Trash2 } from 'lucide-solid';
import { type Accessor } from 'solid-js';
import { type Book, getBookDownloadName, getBookDownloadUrl } from '@/api/books';
import Menu, { type MenuItem } from '@/components/common/Menu/Menu';
import { useI18n } from '@/i18n/I18nProvider';

function BookActionsMenu(props: {
  book: Accessor<Book>;
  onFavoriteToggle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onResetProgress: (book: Book) => void;
  onShowCover: (book: Book) => void;
  onAction?: () => void;
}) {
  const { t } = useI18n();

  const downloadBook = () => {
    const book = props.book();
    const link = document.createElement('a');
    link.href = getBookDownloadUrl(book.id);
    link.download = getBookDownloadName(book);
    document.body.append(link);
    link.click();
    link.remove();
  };

  const menuItems = (): MenuItem[] => [
    {
      id: 'favorite',
      label: props.book().favorite ? t('removeFromFavorites') : t('addToFavorites'),
      iconStart: <Heart />,
      onClick: () => props.onFavoriteToggle(props.book()),
    },
    {
      id: 'edit',
      label: t('edit'),
      iconStart: <Edit3 />,
      onClick: () => props.onEdit(props.book()),
    },
    {
      id: 'reset-progress',
      label: t('resetReadingProgress'),
      iconStart: <RotateCcw />,
      onClick: () => props.onResetProgress(props.book()),
    },
    {
      id: 'show-cover',
      label: t('showFullCoverMenu'),
      iconStart: <Eye />,
      onClick: () => props.onShowCover(props.book()),
    },
    {
      id: 'download',
      label: t('downloadBook'),
      iconStart: <Download />,
      onClick: downloadBook,
    },
    { type: 'separator' },
    {
      id: 'delete',
      label: t('delete'),
      iconStart: <Trash2 />,
      onClick: () => props.onDelete(props.book()),
    },
  ];

  return <Menu items={menuItems()} onClick={props.onAction} />;
}

export default BookActionsMenu;
