alter table book_files drop constraint book_files_format_check;

alter table book_files
    add constraint book_files_format_check check (format in ('pdf', 'fb2', 'epub'));
