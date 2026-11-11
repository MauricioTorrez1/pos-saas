package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.core.sync.SyncChangeFeed.Change;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Serves one page of the change feed to a register (RF-023, ADR 0048). The business is the one of the
 * transaction context, which the filter takes from the token, so nothing in the request can name another.
 */
@Service
class SyncPullService {

    static final int DEFAULT_LIMIT = 200;
    static final int MAX_LIMIT = 500;
    static final String START = "0";

    private static final Pattern CURSOR = Pattern.compile("^(0|[1-9][0-9]{0,15})$");

    private final SyncChangeFeed feed;
    private final TransactionTemplate transaction;

    SyncPullService(SyncChangeFeed feed, TransactionTemplate transaction) {
        this.feed = feed;
        this.transaction = transaction;
    }

    /**
     * One page of changes.
     *
     * @param changes    the changes, in ascending order
     * @param nextCursor what the register must send next; equal to the cursor it sent when there was nothing new
     * @param hasMore    whether more changes were waiting when the page was read
     */
    record Page(List<Change> changes, String nextCursor, boolean hasMore) {
    }

    /**
     * Reads the page that follows a cursor.
     *
     * @param cursor the cursor the register stored, or {@code null} to start from the beginning
     * @param limit  the page size, or {@code null} for the default
     * @return the page
     * @throws InvalidBatchException if the cursor or the limit is not valid
     * @throws CursorAheadException  if the cursor is beyond the last change of the business
     */
    Page pull(String cursor, Integer limit) {
        long after = parseCursor(cursor);
        int size = limit == null ? DEFAULT_LIMIT : limit;
        if (size < 1 || size > MAX_LIMIT) {
            throw new InvalidBatchException("limit must be between 1 and " + MAX_LIMIT);
        }
        return transaction.execute(status -> {
            List<Change> read = feed.after(after, size + 1);
            if (read.isEmpty()) {
                long head = feed.head();
                if (after > head) {
                    throw new CursorAheadException(after, head);
                }
                return new Page(List.of(), String.valueOf(after), false);
            }
            boolean hasMore = read.size() > size;
            List<Change> changes = hasMore ? read.subList(0, size) : read;
            return new Page(changes, String.valueOf(changes.getLast().seq()), hasMore);
        });
    }

    private static long parseCursor(String cursor) {
        String text = cursor == null || cursor.isEmpty() ? START : cursor;
        if (!CURSOR.matcher(text).matches()) {
            throw new InvalidBatchException("cursor must be the value of nextCursor of an earlier answer, or 0");
        }
        return Long.parseLong(text);
    }
}
