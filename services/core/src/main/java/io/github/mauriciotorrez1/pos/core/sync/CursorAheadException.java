package io.github.mauriciotorrez1.pos.core.sync;

/** The cursor of a register is beyond the last change of the core, as after the core was restored from a backup. */
class CursorAheadException extends RuntimeException {

    CursorAheadException(long cursor, long head) {
        super("The cursor " + cursor + " is ahead of the core (" + head + "). Start again from 0.");
    }
}
