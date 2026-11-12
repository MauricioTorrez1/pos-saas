package io.github.mauriciotorrez1.pos.core.catalog;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The SAT keys the business accepts: {@code c_ClaveProdServ} (what a product is) and {@code c_ClaveUnidad} (how it
 * is measured). The complete SAT catalog has tens of thousands of rows and almost all are irrelevant to a hardware
 * store, so the core reads a short, reviewable CSV file per catalog and rejects a key that is not in it (ADR 0056).
 * The files ship in {@code src/main/resources/sat}; setting {@code pos.sat.catalog-dir} reads them from a folder
 * instead, so the accountant's additions need no rebuild.
 */
@Component
public class SatCatalog {

    private static final Pattern PRODUCT_KEY = Pattern.compile("[0-9]{8}");
    private static final Pattern UNIT_KEY = Pattern.compile("[A-Z0-9]{2,3}");

    private final Map<String, String> productKeys;
    private final Map<String, String> unitKeys;

    SatCatalog(@Value("${pos.sat.catalog-dir:}") String directory) {
        this.productKeys = load("c_ClaveProdServ.csv", directory, PRODUCT_KEY);
        this.unitKeys = load("c_ClaveUnidad.csv", directory, UNIT_KEY);
    }

    /**
     * Checks a {@code c_ClaveProdServ} key.
     *
     * @param key the key, 8 digits
     * @return the key
     * @throws InvalidProductException if the format is wrong or the key is not in the reviewed file
     */
    public String requireProductKey(String key) {
        return require("SAT product key", key, PRODUCT_KEY, productKeys, "c_ClaveProdServ.csv");
    }

    /**
     * Checks a {@code c_ClaveUnidad} key.
     *
     * @param key the key, 2 or 3 uppercase letters or digits
     * @return the key
     * @throws InvalidProductException if the format is wrong or the key is not in the reviewed file
     */
    public String requireUnitKey(String key) {
        return require("SAT unit key", key, UNIT_KEY, unitKeys, "c_ClaveUnidad.csv");
    }

    /**
     * Tells how many keys of each catalog are loaded.
     *
     * @return the number of product keys and unit keys, for logs and tests
     */
    public String summary() {
        return productKeys.size() + " product keys, " + unitKeys.size() + " unit keys";
    }

    private static String require(String what, String key, Pattern format, Map<String, String> known, String file) {
        if (key == null || !format.matcher(key).matches()) {
            throw new InvalidProductException(what + " has an invalid format: " + (key == null ? "null" : key));
        }
        if (!known.containsKey(key)) {
            throw new InvalidProductException(what + " " + key + " is not in the reviewed catalog (" + file
                    + "); confirm it in the SAT catalog and add it to that file");
        }
        return key;
    }

    private static Map<String, String> load(String file, String directory, Pattern format) {
        try (InputStream raw = open(file, directory);
             BufferedReader reader = new BufferedReader(new InputStreamReader(raw, StandardCharsets.UTF_8))) {
            Map<String, String> keys = new LinkedHashMap<>();
            String line;
            while ((line = reader.readLine()) != null) {
                String text = line.strip();
                if (text.isEmpty() || text.startsWith("#")) {
                    continue;
                }
                int comma = text.indexOf(',');
                String key = comma < 0 ? text : text.substring(0, comma).strip();
                if (!format.matcher(key).matches()) {
                    throw new IllegalStateException("Bad key '" + key + "' in " + file);
                }
                if (keys.put(key, comma < 0 ? "" : text.substring(comma + 1).strip()) != null) {
                    throw new IllegalStateException("Repeated key '" + key + "' in " + file);
                }
            }
            return Map.copyOf(keys);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read the SAT catalog " + file, e);
        }
    }

    private static InputStream open(String file, String directory) throws IOException {
        if (directory != null && !directory.isBlank()) {
            return Files.newInputStream(Path.of(directory).resolve(file));
        }
        InputStream stream = SatCatalog.class.getResourceAsStream("/sat/" + file);
        if (stream == null) {
            throw new IOException("Missing resource /sat/" + file);
        }
        return stream;
    }
}
