package io.github.mauriciotorrez1.pos.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** Rules of the matrix that need no server, and the check that the reviewed document matches the code. */
class PermissionMatrixTest {

    private static final Path DOCUMENT = Path.of("../../docs/permisos.md").toAbsolutePath().normalize();
    private static final String BEGIN = "<!-- matrix:begin -->";
    private static final String END = "<!-- matrix:end -->";

    @Test
    void theOwnerHoldsEveryPermission() {
        assertThat(Permission.of(Role.OWNER)).containsExactlyInAnyOrder(Permission.values());
    }

    @Test
    void aManagerHoldsNothingTheOwnerLacksAndACashierNothingTheManagerLacks() {
        assertThat(Permission.of(Role.OWNER)).containsAll(Permission.of(Role.MANAGER));
        assertThat(Permission.of(Role.MANAGER)).containsAll(Permission.of(Role.CASHIER));
    }

    @Test
    void aCashierCannotChangePrices() {
        assertThat(Permission.PRICE_CHANGE.grantedTo(Role.CASHIER)).isFalse();
        assertThat(Permission.PRICE_CHANGE.grantedTo(Role.MANAGER)).isFalse();
    }

    @Test
    void permissionIdsAreUniqueLowercaseNames() {
        Set<String> ids = new HashSet<>();
        for (Permission permission : Permission.values()) {
            assertThat(permission.id()).matches("[a-z]+(\\.[a-z]+)+");
            assertThat(ids.add(permission.id())).as("duplicate id %s", permission.id()).isTrue();
        }
    }

    @Test
    void everyRuleIsUniqueAndEveryPermissionIsUsedByARule() {
        Set<String> keys = EndpointPermissions.RULES.stream()
                .map(rule -> rule.method() + " " + rule.pattern()).collect(Collectors.toSet());
        assertThat(keys).hasSameSizeAs(EndpointPermissions.RULES);

        Set<Permission> used = EndpointPermissions.RULES.stream()
                .map(EndpointRule::permission).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        assertThat(used).as("a permission no endpoint asks for is dead code").containsExactlyInAnyOrder(Permission.values());
    }

    @Test
    void theDocumentTheFamilyReviewsShowsTheSameMatrixAsTheCode() throws IOException {
        String document = Files.readString(DOCUMENT, StandardCharsets.UTF_8).replace("\r\n", "\n");
        int begin = document.indexOf(BEGIN);
        int end = document.indexOf(END);
        assertThat(begin).as("marker %s in %s", BEGIN, DOCUMENT).isNotNegative();
        assertThat(end).isGreaterThan(begin);

        String shown = document.substring(begin + BEGIN.length(), end).strip();

        assertThat(shown).isEqualTo(matrixAsMarkdown());
    }

    /** The table of {@code docs/permisos.md}, generated from the code so the two cannot drift apart. */
    static String matrixAsMarkdown() {
        StringBuilder table = new StringBuilder("| Endpoint | Permiso | Dueño | Encargado | Cajero |\n| --- | --- | :---: | :---: | :---: |");
        for (EndpointRule rule : EndpointPermissions.RULES) {
            table.append("\n| `").append(rule.method()).append(' ').append(rule.pattern()).append("` | ")
                    .append(rule.permission() == null ? "(" + rule.access().name().toLowerCase() + ")" : "`" + rule.permission().id() + "`")
                    .append(" |");
            Arrays.stream(Role.values()).forEach(role -> table.append(' ').append(cell(rule, role)).append(" |"));
        }
        return table.toString();
    }

    private static String cell(EndpointRule rule, Role role) {
        return rule.access() != EndpointRule.Access.PERMISSION || rule.permission().grantedTo(role) ? "Sí" : "—";
    }
}
