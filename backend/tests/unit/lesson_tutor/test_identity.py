from app.auth.clerk import ClerkPrincipal
from app.modules.lesson_tutor.identity import derive_tutor_actor_ref


def test_actor_ref_is_domain_separated_stable_and_contains_no_raw_identity() -> None:
    principal = ClerkPrincipal(user_id="user_123", issuer="https://clerk.example")
    actor_ref = derive_tutor_actor_ref(key=b"k" * 32, principal=principal)
    assert actor_ref == "tusr_v1_xZGpLTnTPeqCYbmd243GJI8wimEfmf6reC65-F4fqUg"
    assert "user_123" not in actor_ref
    assert len(actor_ref) == 51
