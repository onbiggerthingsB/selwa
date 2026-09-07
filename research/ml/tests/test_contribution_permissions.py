"""Synthetic permission contracts only: these records are not real consent."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import unittest

from ht_tibetan.permissions import EXAMPLE_CONTRIBUTION_FIELDS, validate_permissions
from ht_tibetan.records import example_sha256, load_dataset

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"
NOW = "2026-09-05T12:00:00Z"


def synthetic_grant(example, *, grant_id=None):
    return {"grant_id": grant_id or "permission-" + example["example_id"], "revision": 1,
        "supersedes_grant_id": None, "contributor_id": example["contributor_id"],
        "contribution_kind": "example_bundle", "contribution_fields": EXAMPLE_CONTRIBUTION_FIELDS.copy(),
        "example_id": example["example_id"], "example_version": example["version"],
        "example_sha256": example_sha256(example), "permitted_uses": ["review", "development_screen", "private_research"],
        "status": "active", "evidence_ref": "synthetic-evidence-only-1",
        "recorded_at": "2026-09-04T12:00:00Z", "granted_at": "2026-09-04T10:00:00Z", "expires_at": None}


def synthetic_permissions(dataset):
    return {"schema_kind": "contribution_permissions", "schema_version": "1.0",
        "evidence_kind": "synthetic_test", "grants": [synthetic_grant(example) for example in dataset["examples"]]}


class ContributionPermissionTests(unittest.TestCase):
    def setUp(self):
        self.dataset = load_dataset(FIXTURES / "synthetic-dataset.json")
        self.permissions = synthetic_permissions(self.dataset)

    def check(self, *, purpose="review", as_of=NOW):
        return validate_permissions(self.dataset, self.permissions, purpose=purpose, as_of=as_of)

    def assertBlocked(self, code, **kwargs):
        report = self.check(**kwargs)
        self.assertFalse(report["valid"], report)
        self.assertEqual(report["clearances"], [])
        self.assertIn(code, {item["code"] for item in report["errors"]}, report)

    def revise(self, **changes):
        prior = self.permissions["grants"][0]
        current = {**deepcopy(prior), "grant_id": "revision-2", "revision": 2,
            "supersedes_grant_id": prior["grant_id"], "recorded_at": "2026-09-05T10:00:00Z", **changes}
        self.permissions["grants"].append(current)
        return current

    def declare_source_author(self):
        source = self.dataset["sources"][0]
        source["source_kind"] = "community"
        binding = {"source_id": source["source_id"], "source_version": source["version"],
            "source_sha256": source["content_sha256"]}
        self.permissions["source_contributors"] = [{**binding, "contributor_ids": ["source-author-1"]}]
        grant = deepcopy(self.permissions["grants"][0])
        for key in ("example_id", "example_version", "example_sha256"):
            del grant[key]
        grant.update(binding, grant_id="source-permission-1", contributor_id="source-author-1",
            contribution_kind="source_text", contribution_fields=["original_text"])
        self.permissions["grants"].append(grant)
        return grant

    def test_current_active_exact_grants_clear_all_selected_examples(self):
        report = self.check()
        self.assertTrue(report["valid"], report)
        self.assertEqual(len(report["clearances"]), 2)
        self.assertEqual(report["evidence_kind"], "synthetic_test")
        self.assertEqual(report["as_of"], NOW)
        self.assertEqual(len(report["permissions_sha256"]), 64)
        self.assertFalse(report["scope"]["source_authorship_exhaustive"])
        self.assertFalse(report["scope"]["underlying_evidence_verified"])
        self.assertEqual(len(report["scope"]["sources_without_author_registry"]), 2)

    def test_missing_permission_blocks_including_otherwise_valid_source_rights(self):
        self.permissions["grants"].pop()
        self.assertBlocked("missing_contributor_permission")

    def test_wrong_author_cannot_clear_primary_contribution(self):
        self.permissions["grants"][0]["contributor_id"] = "somebody-else"
        self.assertBlocked("missing_contributor_permission")

    def test_hash_and_version_bind_full_example_content(self):
        original = deepcopy(self.permissions)
        for field, value in (("example_sha256", "0" * 64), ("example_version", 2)):
            with self.subTest(field=field):
                self.permissions = deepcopy(original)
                self.permissions["grants"][0][field] = value
                self.assertBlocked("stale_contributor_permission")

    def test_question_claim_and_answer_edits_each_invalidate_consent(self):
        original = deepcopy(self.dataset)
        for field, value in (("question", "Changed?"), ("allowed_claims", ["Changed claim."]),
                             ("approved_answer", "A new answer.")):
            with self.subTest(field=field):
                self.dataset = deepcopy(original)
                self.dataset["examples"][0][field] = value
                self.assertBlocked("stale_contributor_permission")

    def test_split_and_exposure_changes_do_not_invalidate_content_consent(self):
        before = self.check()
        self.dataset["examples"][0].update(split="validation", exposures=["development_screen"], review_state="rejected")
        after = self.check()
        self.assertTrue(after["valid"], after)
        self.assertEqual(before["clearances"], after["clearances"])
        self.assertEqual(before["permissions_sha256"], after["permissions_sha256"])

    def test_review_does_not_imply_train_or_private_research_permission(self):
        for source in self.dataset["sources"]:
            source["permitted_uses"].append("train")
        self.assertBlocked("contributor_use_not_permitted", purpose="train")
        self.permissions["grants"][0]["permitted_uses"] = ["review"]
        self.assertBlocked("contributor_use_not_permitted", purpose="private_research")

    def test_contributor_grant_does_not_replace_source_rights(self):
        self.dataset["sources"][0]["permitted_uses"].remove("review")
        self.assertBlocked("source_use_not_permitted")

    def test_expiry_is_exclusive_at_the_exact_as_of_instant(self):
        self.permissions["grants"][0]["expires_at"] = NOW
        self.assertBlocked("expired_contributor_permission")
        self.assertTrue(self.check(as_of="2026-09-05T11:59:59Z")["valid"])

    def test_current_revocation_decline_or_pending_never_falls_back(self):
        original = deepcopy(self.permissions)
        for status in ("revoked", "declined", "pending"):
            with self.subTest(status=status):
                self.permissions = deepcopy(original)
                self.revise(status=status, permitted_uses=[])
                self.assertBlocked("inactive_contributor_permission")

    def test_current_expired_restricted_or_stale_revision_never_falls_back(self):
        original = deepcopy(self.permissions)
        for changes, code in (({"expires_at": NOW}, "expired_contributor_permission"),
                              ({"permitted_uses": ["private_research"]}, "contributor_use_not_permitted"),
                              ({"example_sha256": "0" * 64, "granted_at": "2026-09-05T09:00:00Z"}, "stale_contributor_permission")):
            with self.subTest(changes=changes):
                self.permissions = deepcopy(original)
                self.revise(**changes)
                self.assertBlocked(code)

    def test_current_revision_may_bind_new_content_without_discarding_old_history(self):
        self.dataset["examples"][0]["version"] += 1
        self.dataset["examples"][0]["question"] += " Please."
        self.revise(example_version=2, example_sha256=example_sha256(self.dataset["examples"][0]),
                    granted_at="2026-09-05T09:00:00Z")
        report = self.check()
        self.assertTrue(report["valid"], report)
        self.assertEqual(report["clearances"][0]["grant_id"], "revision-2")

    def test_revision_order_in_array_is_irrelevant(self):
        self.revise()
        expected = self.check()["clearances"]
        self.permissions["grants"].reverse()
        self.assertEqual(self.check()["clearances"], expected)

    def test_new_content_or_expanded_use_cannot_reuse_older_permission_time(self):
        original = deepcopy(self.permissions)
        self.revise(permitted_uses=["review", "development_screen", "private_research", "train"])
        self.assertBlocked("permission_revision")
        self.permissions = original
        self.dataset["examples"][0]["question"] += " Please."
        self.revise(example_sha256=example_sha256(self.dataset["examples"][0]))
        self.assertBlocked("permission_revision")

    def test_duplicate_ids_roots_forks_gaps_and_foreign_chains_fail(self):
        original = deepcopy(self.permissions)
        for mutation in ("duplicate_id", "new_root", "fork", "gap", "missing_prior", "foreign_author"):
            with self.subTest(mutation=mutation):
                self.permissions = deepcopy(original)
                current = self.revise()
                if mutation == "duplicate_id":
                    current["grant_id"] = self.permissions["grants"][0]["grant_id"]
                elif mutation == "new_root":
                    current.update(revision=1, supersedes_grant_id=None)
                elif mutation == "fork":
                    self.permissions["grants"].append({**current, "grant_id": "forked-revision"})
                elif mutation == "gap":
                    current["revision"] = 3
                elif mutation == "missing_prior":
                    current["supersedes_grant_id"] = "nonexistent"
                else:
                    current["contributor_id"] = "somebody-else"
                self.assertBlocked("duplicate_grant" if mutation == "duplicate_id" else "permission_revision")

    def test_revocation_cannot_be_undone_by_a_second_initial_grant(self):
        self.revise(status="revoked")
        self.permissions["grants"].append({**deepcopy(self.permissions["grants"][0]), "grant_id": "reset-permission"})
        self.assertBlocked("permission_revision")

    def test_restoration_needs_new_permission_time(self):
        revoked = self.revise(status="revoked")
        restored = {**deepcopy(revoked), "grant_id": "restored", "revision": 3,
            "supersedes_grant_id": revoked["grant_id"], "status": "active",
            "recorded_at": "2026-09-05T11:00:00Z"}
        self.permissions["grants"].append(restored)
        self.assertBlocked("permission_revision")
        restored["granted_at"] = "2026-09-05T10:30:00Z"
        self.assertTrue(self.check()["valid"])

    def test_expiry_extension_requires_new_permission_even_when_first_record_was_immediate(self):
        original = deepcopy(self.permissions)
        for extended in (None, "2026-09-10T00:00:00Z"):
            with self.subTest(extended=extended):
                self.permissions = deepcopy(original)
                grant = self.permissions["grants"][0]
                grant["granted_at"] = grant["recorded_at"]
                grant["expires_at"] = "2026-09-05T00:00:00Z"
                current = self.revise(expires_at=extended)
                self.assertBlocked("permission_revision")
                current["granted_at"] = "2026-09-05T09:00:00Z"
                self.assertTrue(self.check()["valid"])

    def test_intermediate_revision_cannot_lower_or_null_out_the_permission_clock(self):
        original = deepcopy(self.permissions)
        for mutation in ("lower", "null"):
            with self.subTest(mutation=mutation):
                self.permissions = deepcopy(original)
                first = self.permissions["grants"][0]
                first["granted_at"] = first["recorded_at"]
                first["expires_at"] = "2026-09-04T13:00:00Z"
                middle = self.revise(recorded_at=first["recorded_at"],
                    granted_at="2026-09-04T11:00:00Z" if mutation == "lower" else None,
                    status="active" if mutation == "lower" else "revoked")
                self.permissions["grants"].append({**deepcopy(middle), "grant_id": "expiry-extension",
                    "revision": 3, "supersedes_grant_id": middle["grant_id"], "status": "active",
                    "granted_at": first["granted_at"], "expires_at": None,
                    "recorded_at": "2026-09-05T10:00:00Z"})
                self.assertBlocked("permission_revision")

    def test_timestamp_schema_and_ordering_are_fail_closed(self):
        original = deepcopy(self.permissions)
        for field, value in (("recorded_at", "2026-09-06T00:00:00Z"), ("granted_at", None),
                             ("granted_at", "2026-09-05T00:00:00Z"),
                             ("expires_at", "2026-09-04T09:00:00Z")):
            with self.subTest(field=field, value=value):
                self.permissions = deepcopy(original)
                self.permissions["grants"][0][field] = value
                self.assertBlocked("permission_time")
        self.permissions = deepcopy(original)
        self.revise(recorded_at="2026-09-04T11:00:00Z")
        self.assertBlocked("permission_revision")

    def test_as_of_required_and_timezone_explicit(self):
        for value in (None, "2026-09-05", "2026-09-05T12:00:00", datetime(2026, 9, 5)):
            with self.subTest(value=value):
                self.assertBlocked("permission_time", as_of=value)
        self.assertTrue(self.check(as_of=datetime(2026, 9, 5, 12, tzinfo=timezone.utc))["valid"])
        self.assertEqual(self.check(as_of="2026-09-05T08:00:00-04:00")["as_of"], NOW)

    def test_schema_requires_explicit_version_scope_nulls_and_opaque_evidence(self):
        original = deepcopy(self.permissions)
        for mutation in ("missing_kind", "wrong_version", "missing_expiry", "partial_fields", "blank_evidence", "personal_evidence", "unknown_field"):
            with self.subTest(mutation=mutation):
                self.permissions = deepcopy(original)
                grant = self.permissions["grants"][0]
                if mutation == "missing_kind":
                    del self.permissions["schema_kind"]
                elif mutation == "wrong_version":
                    self.permissions["schema_version"] = "2.0"
                elif mutation == "missing_expiry":
                    del grant["expires_at"]
                elif mutation == "partial_fields":
                    grant["contribution_fields"] = ["question"]
                elif mutation == "blank_evidence":
                    grant["evidence_ref"] = " "
                elif mutation == "personal_evidence":
                    grant["evidence_ref"] = "test@example.com"
                else:
                    grant["auto_consent"] = True
                self.assertBlocked("schema")

    def test_community_source_requires_declared_authors_and_each_source_grant(self):
        self.dataset["sources"][0]["source_kind"] = "community"
        self.assertBlocked("missing_source_authors")
        self.declare_source_author()
        report = self.check()
        self.assertTrue(report["valid"], report)
        self.assertEqual(len(report["clearances"]), 3)
        self.permissions["grants"].pop()
        self.assertBlocked("missing_contributor_permission")

    def test_publication_rights_do_not_assert_personal_author_consent(self):
        self.dataset["sources"][0]["source_kind"] = "publication"
        report = self.check()
        self.assertTrue(report["valid"], report)
        self.assertIn(self.dataset["sources"][0]["source_id"], report["scope"]["sources_without_author_registry"])

    def test_source_registry_hash_revision_duplicates_and_revocation_are_checked(self):
        self.declare_source_author()
        original = deepcopy(self.permissions)
        for mutation, code in (("hash", "stale_source_authors"), ("version", "stale_source_authors"),
                               ("duplicate", "duplicate_source_authors"), ("revoked", "inactive_contributor_permission")):
            with self.subTest(mutation=mutation):
                self.permissions = deepcopy(original)
                if mutation == "hash":
                    self.permissions["source_contributors"][0]["source_sha256"] = "0" * 64
                elif mutation == "version":
                    self.permissions["source_contributors"][0]["source_version"] = 2
                elif mutation == "duplicate":
                    self.permissions["source_contributors"] *= 2
                else:
                    self.permissions["grants"][-1]["status"] = "revoked"
                self.assertBlocked(code)

    def test_additional_example_author_needs_own_grant_for_exact_bundle(self):
        example = self.dataset["examples"][0]
        self.permissions["example_contributors"] = [{"example_id": example["example_id"],
            "example_version": example["version"], "example_sha256": example_sha256(example),
            "contributor_ids": [example["contributor_id"], "answer-author-2"]}]
        self.assertBlocked("missing_contributor_permission")
        additional = synthetic_grant(example, grant_id="additional-author-grant")
        additional["contributor_id"] = "answer-author-2"
        self.permissions["grants"].append(additional)
        self.assertTrue(self.check()["valid"])
        self.permissions["example_contributors"][0]["contributor_ids"] = ["answer-author-2"]
        self.assertBlocked("missing_primary_author")

    def test_stale_additional_author_registry_blocks_even_current_grants(self):
        example = self.dataset["examples"][0]
        self.permissions["example_contributors"] = [{"example_id": example["example_id"],
            "example_version": 2, "example_sha256": example_sha256(example),
            "contributor_ids": [example["contributor_id"]]}]
        self.assertBlocked("stale_example_authors")

    def test_removing_example_coauthor_declaration_cannot_hide_their_recorded_revocation(self):
        example = self.dataset["examples"][0]
        coauthor = synthetic_grant(example, grant_id="coauthor-grant")
        coauthor["contributor_id"] = "coauthor-1"
        self.permissions["grants"].append(coauthor)
        self.permissions["grants"].append({**deepcopy(coauthor), "grant_id": "coauthor-revocation",
            "revision": 2, "supersedes_grant_id": coauthor["grant_id"], "status": "revoked",
            "recorded_at": "2026-09-05T10:00:00Z"})
        # There is deliberately no example_contributors declaration. The complete
        # exact-content grant history already establishes this coauthor as known.
        self.assertBlocked("inactive_contributor_permission")

    def test_removing_source_coauthor_from_registry_cannot_hide_their_recorded_revocation(self):
        first = self.declare_source_author()
        other = {**deepcopy(first), "grant_id": "source-coauthor-grant", "contributor_id": "source-coauthor"}
        self.permissions["grants"].append(other)
        self.permissions["grants"].append({**deepcopy(other), "grant_id": "source-coauthor-revocation",
            "revision": 2, "supersedes_grant_id": other["grant_id"], "status": "revoked",
            "recorded_at": "2026-09-05T10:00:00Z"})
        # Registry still names the first author, but dropped this known coauthor.
        self.assertBlocked("inactive_contributor_permission")
        self.dataset["sources"][0]["source_kind"] = "publication"
        del self.permissions["source_contributors"]
        self.assertBlocked("inactive_contributor_permission")

    def test_source_version_bump_cannot_erase_known_author_of_unchanged_text(self):
        first = self.declare_source_author()
        other = {**deepcopy(first), "grant_id": "source-coauthor-grant", "contributor_id": "source-coauthor", "status": "revoked"}
        self.permissions["grants"].append(other)
        source = self.dataset["sources"][0]
        source["version"] = 2
        self.dataset["examples"][0]["source_version"] = 2
        self.permissions["source_contributors"][0]["source_version"] = 2
        self.permissions["grants"].append({**deepcopy(first), "grant_id": "source-version-2-grant",
            "source_version": 2, "revision": 2, "supersedes_grant_id": first["grant_id"],
            "recorded_at": "2026-09-05T10:00:00Z", "granted_at": "2026-09-05T09:00:00Z"})
        self.revise(example_sha256=example_sha256(self.dataset["examples"][0]),
            granted_at="2026-09-05T09:00:00Z")
        self.assertBlocked("stale_contributor_permission")

    def test_unknown_use_invalid_dataset_and_nonfinite_ledger_fail_closed(self):
        self.assertBlocked("permission_purpose", purpose="all")
        self.permissions["grants"][0]["revision"] = float("nan")
        self.assertBlocked("schema")
        self.permissions = synthetic_permissions(self.dataset)
        self.dataset["sources"][0]["original_text"] += "!"
        self.assertBlocked("source_hash")


if __name__ == "__main__":
    unittest.main()
