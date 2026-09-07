"""Explicit local commands; network and model work are never implicit."""
from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

from .artifacts import make_manifest, write_json_new
from .inference import FakeInference, InferenceRequest, OUTCOMES
from .preflight import inspect, DEFAULT_RESERVE, default_root


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog='ht-tibetan', description='Local research tooling; no implicit model downloads.')
    sub = p.add_subparsers(dest='command', required=True)
    f = sub.add_parser('preflight', help='Read hardware/runtime and account for projected disk use')
    f.add_argument('--root', type=Path)
    f.add_argument('--projected-bytes', type=int, default=0)
    f.add_argument('--reserve-bytes', type=int, default=DEFAULT_RESERVE)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('fake-inference', help='Exercise a synthetic result or failure without a model')
    f.add_argument('--run-id', required=True)
    f.add_argument('--prompt', default='Exercise the transport contract.')
    f.add_argument('--outcome', choices=sorted(OUTCOMES), default='success')
    f.add_argument('--output', type=Path)
    for name in ('validate', 'audit-splits'):
        f = sub.add_parser(name)
        f.add_argument('dataset', type=Path)
        f.add_argument('--output', type=Path)
        if name == 'audit-splits':
            f.add_argument('--contributor-policy', choices=['report','disjoint'], default='report')
    f = sub.add_parser('audit-data-use', help='Check recorded permissions and cumulative exposure without loading a model or releasing data')
    f.add_argument('dataset', type=Path)
    f.add_argument('--permissions', type=Path, required=True)
    f.add_argument('--purpose', choices=['development_screen', 'smoke_training', 'train', 'validation', 'final_test', 'private_research', 'review'], required=True)
    f.add_argument('--root', type=Path)
    f.add_argument('--example-id', action='append')
    f.add_argument('--contributor-policy', choices=['report', 'disjoint'], default='report')
    f.add_argument('--output', type=Path)
    f = sub.add_parser('export-review')
    f.add_argument('dataset', type=Path)
    f.add_argument('--reviewer-id', required=True)
    f.add_argument('--reviewer-role', default='language_reviewer')
    f.add_argument('--review-type', default='language')
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('import-review')
    f.add_argument('dataset', type=Path)
    f.add_argument('packet', type=Path)
    f.add_argument('--receipt', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('manifest')
    f.add_argument('--run-id', required=True)
    f.add_argument('--kind', required=True)
    f.add_argument('--input', type=Path, action='append', default=[])
    f.add_argument('--outcome', choices=['completed','failed','interrupted'], required=True)
    f.add_argument('--output', type=Path, required=True)
    for name in ('acquire', 'verify-model', 'audit-tokens'):
        f = sub.add_parser(name)
        f.add_argument('--lock', type=Path, required=True)
        f.add_argument('--candidate', required=True)
        f.add_argument('--weights', action='store_true')
        f.add_argument('--output', type=Path)
        if name == 'acquire':
            f.add_argument('--root', type=Path)
            f.add_argument('--reserve-bytes', type=int, default=DEFAULT_RESERVE)
        else:
            f.add_argument('--snapshot', type=Path, required=True)
        if name == 'audit-tokens':
            f.add_argument('cases', type=Path)
            f.add_argument('--context-limit', type=int, default=2048)
            f.add_argument('--max-output-tokens', type=int, default=128)
            f.add_argument('--reasoning-mode', choices=['disabled', 'enabled'], default='disabled')
    f = sub.add_parser('run-baseline')
    f.add_argument('dataset', type=Path)
    f.add_argument('--config', type=Path, required=True)
    f.add_argument('--lock', type=Path, required=True)
    f.add_argument('--parallel', type=Path, help='Versioned paired-material sidecar, required only for config 1.1')
    f.add_argument('--permissions', type=Path, help='Current contribution permission ledger; required for real language baselines')
    f.add_argument('--root', type=Path)
    f.add_argument('--output', type=Path, required=True, help='New run directory')
    f = sub.add_parser('train-mechanics', help='Run a bounded synthetic-only local adapter update and fresh-process reload')
    f.add_argument('--lock', type=Path, required=True)
    f.add_argument('--candidate', required=True)
    f.add_argument('--root', type=Path)
    f.add_argument('--output', type=Path, required=True, help='New directory below the private research root/runs')
    f.add_argument('--steps', type=int, default=20)
    f.add_argument('--timeout-seconds', type=float, default=300)
    f = sub.add_parser('build-release', help='Create immutable purpose-specific data with isolated final-test references')
    f.add_argument('dataset', type=Path)
    f.add_argument('--permissions', type=Path)
    f.add_argument('--release-id', required=True)
    f.add_argument('--evidence-kind', choices=['human_review', 'synthetic_test'], required=True)
    f.add_argument('--contributor-policy', choices=['report', 'disjoint'], default='report')
    f.add_argument('--root', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('verify-release', help='Verify only selected data roles; no implicit final-test access')
    f.add_argument('release', type=Path)
    f.add_argument('--permissions', type=Path)
    f.add_argument('--purpose', choices=['development_screen', 'smoke_training', 'train', 'validation', 'final_test'], action='append', required=True)
    f.add_argument('--offline-integrity-only', action='store_true', help='Skip current rights/history; never authorizes model use')
    f.add_argument('--root', type=Path)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('audit-release-tokens', help='Measure exact permitted material and instructions with each pinned tokenizer; never opens final-test data')
    f.add_argument('release', type=Path)
    f.add_argument('--permissions', type=Path, required=True)
    f.add_argument('--lock', type=Path, required=True)
    f.add_argument('--condition', type=Path, required=True)
    f.add_argument('--purpose', choices=['development_screen', 'train', 'validation'], action='append', required=True)
    f.add_argument('--candidate', action='append', required=True)
    f.add_argument('--max-output-segments', type=int)
    f.add_argument('--root', type=Path)
    f.add_argument('--output', type=Path)
    for name in ('train-release', 'evaluate-release'):
        f = sub.add_parser(name)
        f.add_argument('release', type=Path)
        f.add_argument('--permissions', type=Path, required=True)
        f.add_argument('--lock', type=Path, required=True)
        f.add_argument('--root', type=Path)
        f.add_argument('--output', type=Path, required=True)
        f.add_argument('--config', type=Path, required=name == 'evaluate-release')
        if name == 'train-release':
            f.add_argument('--candidate', required=True)
            f.add_argument('--timeout-seconds', type=float, default=300)
        else:
            f.add_argument('--study', type=Path, help='Required preregistered study for real comparisons')
    f = sub.add_parser('validate-study')
    f.add_argument('study', type=Path)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('plan-evaluation', help='List stable output IDs and check pilot alignment without opening data or running a model')
    f.add_argument('config', type=Path)
    f.add_argument('--study', type=Path)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('analyze-agreement', help='Report reviewer agreement and timing with explicit missing-data denominators')
    f.add_argument('ratings', type=Path)
    f.add_argument('--study', type=Path)
    f.add_argument('--timings', type=Path)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('export-evaluation-review', help='Create a blank report-bound independent review packet')
    f.add_argument('report', type=Path)
    f.add_argument('--reviewer-id', required=True)
    f.add_argument('--study', type=Path, required=True)
    f.add_argument('--root', type=Path)
    f.add_argument('--release', type=Path)
    f.add_argument('--permissions', type=Path)
    f.add_argument('--key', type=Path, help='Create a separate private mapping for a blinded reviewer packet')
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('evaluation-review-form', help='Export a verified blinded packet as a standalone offline HTML form')
    f.add_argument('packet', type=Path)
    f.add_argument('--study', type=Path, required=True)
    f.add_argument('--report', type=Path, required=True)
    f.add_argument('--key', type=Path, required=True)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('analyze-evaluation-reviews', help='Analyze independent report-bound ratings without selecting a model')
    f.add_argument('report', type=Path)
    f.add_argument('--study', type=Path, required=True)
    f.add_argument('--review', type=Path, action='append', required=True)
    f.add_argument('--key', type=Path, action='append', help='Private keys in the same order as reviews')
    f.add_argument('--output', type=Path)
    f = sub.add_parser('validate-evaluation-review')
    f.add_argument('packet', type=Path)
    f.add_argument('--study', type=Path, required=True)
    f.add_argument('--report', type=Path, required=True)
    f.add_argument('--key', type=Path)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('record-model-decision', help='Record a human decision bound to independent reviews and a completed comparison')
    f.add_argument('study', type=Path)
    f.add_argument('report', type=Path)
    f.add_argument('decision', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('verify-model-selection')
    f.add_argument('study', type=Path)
    f.add_argument('receipt', type=Path)
    f.add_argument('--candidate', required=True)
    f.add_argument('--report', type=Path, required=True)
    f.add_argument('--model-identity')
    f.add_argument('--output', type=Path)
    f = sub.add_parser('model-card', help='Render measured training/evaluation facts without granting deployment approval')
    f.add_argument('training', type=Path)
    f.add_argument('evaluation', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('validate-parallel', help='Check exact pair bindings, derivative permissions and declared equivalence review')
    f.add_argument('dataset', type=Path)
    f.add_argument('parallel', type=Path)
    f.add_argument('--purpose', choices=['infrastructure_smoke', 'language_baseline'], required=True)
    f.add_argument('--pair-id', action='append', required=True)
    f.add_argument('--output', type=Path)
    f = sub.add_parser('blind-review', help='Export anonymous model-output reviews with a separate private key')
    f.add_argument('run_dir', type=Path)
    f.add_argument('dataset', type=Path)
    f.add_argument('--reviewer-id', required=True)
    f.add_argument('--output', type=Path, required=True)
    f.add_argument('--key', type=Path, required=True)
    f = sub.add_parser('import-output-review', help='Import returned blinded ratings without granting approval')
    f.add_argument('original_packet', type=Path)
    f.add_argument('returned_packet', type=Path)
    f.add_argument('--key', type=Path, required=True)
    f.add_argument('--evidence-kind', choices=['human_review', 'synthetic_test'], required=True)
    f.add_argument('--independent', action=argparse.BooleanOptionalAction, required=True,
                   help='Explicit declaration; incomplete/non-independent ratings cannot be frozen')
    f.add_argument('--previous', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('freeze-output-reviews', help='Freeze a complete independent reviewer roster and report disagreements')
    f.add_argument('run_dir', type=Path)
    f.add_argument('dataset', type=Path)
    f.add_argument('--review', type=Path, action='append', required=True)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('export-output-adjudication', help='Prepare blank decisions after ratings are frozen')
    f.add_argument('freeze', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('adjudicate-output-reviews', help='Record explicit task decisions separately from original ratings')
    f.add_argument('freeze', type=Path)
    f.add_argument('decisions', type=Path)
    f.add_argument('--output', type=Path, required=True)
    f = sub.add_parser('review-form', help='Create a self-contained offline form from a sealed reviewer packet')
    f.add_argument('packet', type=Path)
    proof = f.add_mutually_exclusive_group(required=True)
    proof.add_argument('--key', type=Path)
    proof.add_argument('--receipt', type=Path)
    f.add_argument('--dataset', type=Path)
    f.add_argument('--output', type=Path, required=True)
    return p


def main(argv: list[str] | None = None) -> int:
    p = parser()
    args = p.parse_args(argv)
    try:
        write_output = True
        if args.command == 'preflight':
            result = inspect(args.root, args.projected_bytes, args.reserve_bytes)
            code = 0 if result['storage']['within_budget'] else 2
        elif args.command == 'fake-inference':
            result = asdict(FakeInference(args.outcome).generate(InferenceRequest(args.run_id, args.prompt)))
            code = 0 if result['outcome'] == 'success' else 2
        elif args.command == 'acquire':
            from .acquisition import acquire_snapshot
            result = acquire_snapshot(args.lock, args.candidate, args.root or default_root(),
                include_weights=args.weights, reserve_bytes=args.reserve_bytes)
            code = 0
        elif args.command in ('verify-model', 'audit-tokens'):
            from .acquisition import verify_snapshot
            result = verify_snapshot(args.lock, args.candidate, args.snapshot, include_weights=args.weights)
            code = 0 if result['valid'] else 2
            if args.command == 'audit-tokens' and result['valid']:
                from .records import load_dataset
                from .token_audit import audit_conversations, load_local_tokenizer
                identity = result['identity']
                result = audit_conversations(load_dataset(args.cases), load_local_tokenizer(args.snapshot),
                    candidate_id=args.candidate, context_limit=args.context_limit,
                    max_output_tokens=args.max_output_tokens, reasoning_mode=args.reasoning_mode)
                result['verified_snapshot_identity'] = identity
                code = 0 if result['all_fit'] else 2
        elif args.command == 'run-baseline':
            from .baseline import run_baseline
            result = run_baseline(args.dataset, args.config, args.lock, args.root or default_root(), args.output,
                                  parallel_path=args.parallel, permissions_path=args.permissions)
            code = 0 if result.get('outcome') == 'completed' else 2
            write_output = False
        elif args.command == 'audit-data-use':
            from .data_use import audit_data_use
            from .records import load_dataset
            _, result = audit_data_use(load_dataset(args.dataset), load_dataset(args.permissions),
                (args.root or default_root()) / 'runs', purpose=args.purpose,
                example_ids=args.example_id, contributor_policy=args.contributor_policy)
            code = 0 if result['valid'] else 2
        elif args.command == 'train-mechanics':
            from .training_mechanics import run_mechanics
            result = run_mechanics(args.lock, args.candidate, args.root or default_root(), args.output,
                                   steps=args.steps, timeout_seconds=args.timeout_seconds)
            code, write_output = (0 if result['outcome'] == 'completed' else 2), False
        elif args.command == 'build-release':
            from .releases import build_release
            result = build_release(args.dataset, args.permissions, args.root or default_root(), args.output,
                release_id=args.release_id, evidence_kind=args.evidence_kind, contributor_policy=args.contributor_policy)
            code, write_output = 0, False
        elif args.command == 'verify-release':
            from .releases import verify_release
            result = verify_release(args.release, root=args.root or default_root(), permissions_path=args.permissions,
                purposes=args.purpose, recheck_current=not args.offline_integrity_only)
            result = {key: value for key, value in result.items() if key not in ('dataset', 'datasets')}
            code = 0
        elif args.command == 'train-release':
            from .release_training import run_release_training
            result = run_release_training(args.release, args.permissions, args.lock, args.candidate,
                args.root or default_root(), args.output, config_path=args.config, timeout_seconds=args.timeout_seconds)
            code, write_output = (0 if result['outcome'] == 'completed' else 2), False
        elif args.command == 'audit-release-tokens':
            from .release_token_audit import audit_release_tokens
            from .records import load_dataset
            result = audit_release_tokens(args.release, args.permissions, args.lock, args.root or default_root(),
                purposes=args.purpose, candidate_ids=args.candidate, condition=load_dataset(args.condition),
                max_output_segments=args.max_output_segments)
            code = 0 if result['valid'] and result['all_fit'] else 2
        elif args.command == 'evaluate-release':
            from .evaluation import run_evaluation
            result = run_evaluation(args.release, args.permissions, args.config, args.lock,
                args.root or default_root(), args.output, study_path=args.study)
            code, write_output = (0 if result['outcome'] == 'completed' else 2), False
        elif args.command == 'validate-study':
            from .records import load_dataset
            from .study import validate_study
            result = validate_study(load_dataset(args.study))
            code = 0 if result['valid'] else 2
        elif args.command == 'plan-evaluation':
            from .records import load_dataset
            from .evaluation_plan import build_evaluation_plan
            result = build_evaluation_plan(load_dataset(args.config),
                study=load_dataset(args.study) if args.study is not None else None)
            alignment = result['study_alignment']
            code = 0 if alignment is None or alignment['valid'] else 2
        elif args.command == 'analyze-agreement':
            from .records import load_dataset
            from .study import analyze_agreement
            value = load_dataset(args.ratings)
            result = analyze_agreement(value if value.get('kind') == 'reviewer_agreement_pilot' else args.ratings,
                study=args.study, supplement=args.timings)
            code = 0
        elif args.command == 'export-evaluation-review':
            from .study import export_evaluation_review
            result = export_evaluation_review(args.report, args.reviewer_id, args.output, study=args.study,
                root=args.root or default_root(), permissions_path=args.permissions, release_dir=args.release, key_path=args.key)
            code, write_output = 0, False
        elif args.command == 'validate-evaluation-review':
            from .study import load_evaluation_review
            packet, checksum = load_evaluation_review(args.packet, study=args.study, evaluation_report_path=args.report, key_path=args.key)
            result = {'valid': True, 'status': packet['status'], 'review_sha256': checksum, 'approval_granted': False}
            code = 0
        elif args.command == 'evaluation-review-form':
            from .evaluation_review_form import export_evaluation_review_form
            result = export_evaluation_review_form(args.packet, args.output, study_path=args.study,
                report_path=args.report, key_path=args.key)
            code, write_output = 0, False
        elif args.command == 'analyze-evaluation-reviews':
            from .study import analyze_evaluation_reviews
            result = analyze_evaluation_reviews(args.study, args.review, args.report, review_keys=args.key)
            code = 0
        elif args.command == 'record-model-decision':
            from .records import load_dataset
            from .study import record_model_decision
            result = record_model_decision(args.study, args.report, load_dataset(args.decision))
            code = 0
        elif args.command == 'verify-model-selection':
            from .study import verify_model_selection
            result = verify_model_selection(args.study, args.receipt, args.candidate,
                evaluation_report_path=args.report, model_identity=args.model_identity)
            code = 0 if result['valid'] else 2
        elif args.command == 'model-card':
            import os
            from .records import load_dataset
            from .evaluation_scoring import build_model_card
            card = build_model_card(load_dataset(args.training), load_dataset(args.evaluation))
            args.output.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                stream.write(card)
            result = {'written': str(args.output), 'deployment_ready': False}
            code, write_output = 0, False
        elif args.command == 'validate-parallel':
            from .parallel import validate_parallel_material
            from .records import load_dataset
            result = validate_parallel_material(load_dataset(args.dataset), load_dataset(args.parallel),
                purpose=args.purpose, pair_ids=args.pair_id)
            code = 0
        elif args.command == 'review-form':
            from .review_form import export_review_form
            result = export_review_form(args.packet, args.output, key_path=args.key,
                                       receipt_path=args.receipt, dataset_path=args.dataset)
            code, write_output = 0, False
        elif args.command == 'blind-review':
            from .blind_review import export_blind_packet
            result = export_blind_packet(args.run_dir, args.dataset, args.reviewer_id, args.output, args.key)
            code = 0
            write_output = False
        elif args.command == 'import-output-review':
            from .output_review_import import import_output_review
            result = import_output_review(args.original_packet, args.returned_packet, args.key, args.output,
                evidence_kind=args.evidence_kind, independent=args.independent, previous_path=args.previous)
            code, write_output = 0, False
        elif args.command == 'freeze-output-reviews':
            from .output_review import freeze_output_reviews
            result = freeze_output_reviews(args.run_dir, args.dataset, args.review, args.output)
            code, write_output = 0, False
        elif args.command == 'export-output-adjudication':
            from .output_review import export_output_adjudication
            result = export_output_adjudication(args.freeze, args.output)
            code, write_output = 0, False
        elif args.command == 'adjudicate-output-reviews':
            from .output_review import adjudicate_output_reviews
            result = adjudicate_output_reviews(args.freeze, args.decisions, args.output)
            code, write_output = 0, False
        elif args.command in ('validate','audit-splits','export-review','import-review'):
            from .records import load_dataset, validate_dataset
            dataset = load_dataset(args.dataset)
            if args.command == 'validate':
                result = validate_dataset(dataset)
            elif args.command == 'audit-splits':
                from .splits import audit_splits
                result = audit_splits(dataset, contributor_policy=args.contributor_policy)
            elif args.command == 'export-review':
                from .review import export_review_packet
                result = export_review_packet(dataset, args.output, args.reviewer_id,
                    reviewer_role=args.reviewer_role, review_type=args.review_type)
                write_output = False
            else:
                from .review import import_review_packet
                result = import_review_packet(dataset, args.packet, output_path=args.output,
                    receipt_path=args.receipt)
                write_output = False
            code = 0 if result.get('valid', True) else 2
        else:
            result = make_manifest(args.run_id, args.kind, args.input, {}, args.outcome)
            code = 0
        if args.output and write_output:
            write_json_new(args.output, result)
        # Review commands never echo reviewer content into general logs.
        if args.command in ('export-review','import-review'):
            print(json.dumps({'command':args.command, 'output':str(args.output), 'status':'written'}))
        else:
            print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
        return code
    except (OSError, ValueError, TypeError) as exc:
        print(json.dumps({'error':str(exc), 'command':args.command}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
