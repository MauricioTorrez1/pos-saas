package io.github.mauriciotorrez1.pos.core.catalog;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads a CSV file as rows of text. It understands quoted fields with the delimiter, quotes or line breaks inside,
 * and takes as delimiter the first of semicolon, tab or comma that the first line has, which covers what Excel and
 * Eleventa export. It is small on purpose, so the import needs no library.
 */
final class CsvTable {

    private CsvTable() {
    }

    /**
     * Splits the text of a file.
     *
     * @param text the whole file, with or without a byte order mark
     * @return the rows that have something written, each one a list of fields
     */
    static List<List<String>> parse(String text) {
        String source = text.startsWith("﻿") ? text.substring(1) : text;
        int lineEnd = source.indexOf('\n');
        String firstLine = lineEnd == -1 ? source : source.substring(0, lineEnd);
        char delimiter = firstLine.indexOf(';') >= 0 ? ';' : firstLine.indexOf('\t') >= 0 ? '\t' : ',';

        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int index = 0; index < source.length(); index++) {
            char character = source.charAt(index);
            if (quoted) {
                if (character == '"' && index + 1 < source.length() && source.charAt(index + 1) == '"') {
                    field.append('"');
                    index++;
                } else if (character == '"') {
                    quoted = false;
                } else {
                    field.append(character);
                }
            } else if (character == '"') {
                quoted = true;
            } else if (character == delimiter) {
                row.add(field.toString());
                field.setLength(0);
            } else if (character == '\n' || character == '\r') {
                if (character == '\r' && index + 1 < source.length() && source.charAt(index + 1) == '\n') {
                    index++;
                }
                row.add(field.toString());
                field.setLength(0);
                rows.add(row);
                row = new ArrayList<>();
            } else {
                field.append(character);
            }
        }
        row.add(field.toString());
        rows.add(row);
        return rows.stream().filter(fields -> fields.stream().anyMatch(value -> !value.isBlank())).toList();
    }
}
