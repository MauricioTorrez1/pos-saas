package io.github.mauriciotorrez1.pos.core.identity.web;

import io.github.mauriciotorrez1.pos.core.identity.Enrollment;
import io.github.mauriciotorrez1.pos.core.identity.EnrollmentService;
import io.github.mauriciotorrez1.pos.core.identity.InvalidRequestDataException;
import io.github.mauriciotorrez1.pos.core.identity.IssuedEnrollmentCode;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Registration of physical registers (F0-15, ADR 0043). */
@RestController
@RequestMapping("/registers")
class RegistersController {

    private final CurrentActor currentActor;
    private final EnrollmentService enrollment;

    RegistersController(CurrentActor currentActor, EnrollmentService enrollment) {
        this.currentActor = currentActor;
        this.enrollment = enrollment;
    }

    /**
     * Issues a one-time enrollment code for a register that does not exist yet.
     *
     * @param request the branch, code and name of the future register
     * @param jwt     the token of the owner or manager
     * @return 201 with the code, which is shown only once and never cached
     */
    @PostMapping("/enrollment-codes")
    ResponseEntity<IssuedEnrollmentCode> issueCode(@RequestBody IssueCodeRequest request, @AuthenticationPrincipal Jwt jwt) {
        IssuedEnrollmentCode issued = enrollment.issue(currentActor.of(jwt), request.branchId(),
                request.registerCode(), request.registerName());
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(issued);
    }

    /**
     * Enrolls a register with its code. It needs no token: the code is the credential, it works once and it expires.
     *
     * @param request the business and the code typed on the register
     * @return 201 with the register, its device token (shown only once) and the PIN hashes
     */
    @PostMapping("/enroll")
    ResponseEntity<Enrollment> enroll(@RequestBody EnrollRequest request) {
        if (request.tenantId() == null) {
            throw new InvalidRequestDataException("tenantId is required");
        }
        Enrollment result = enrollment.enroll(request.tenantId(), request.code());
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore()).body(result);
    }

    /**
     * Body of {@code POST /registers/enrollment-codes}.
     *
     * @param branchId     the branch of the future register
     * @param registerCode the code of the register: 1 to 10 uppercase letters or digits
     * @param registerName the display name of the register
     */
    record IssueCodeRequest(UUID branchId, String registerCode, String registerName) {
    }

    /**
     * Body of {@code POST /registers/enroll}. It hides the code from {@code toString}.
     *
     * @param tenantId the business that issued the code
     * @param code     the enrollment code
     */
    record EnrollRequest(UUID tenantId, String code) {

        @Override
        public String toString() {
            return "EnrollRequest[tenantId=" + tenantId + ", code=<redacted>]";
        }
    }
}
