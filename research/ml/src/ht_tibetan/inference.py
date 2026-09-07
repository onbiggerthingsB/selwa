"""Transport-independent interface; fake outputs are explicit fixtures, not model results."""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Literal, Protocol

Outcome = Literal['success', 'timeout', 'cancelled', 'context_overflow', 'runtime_failure']
OUTCOMES = {'success', 'timeout', 'cancelled', 'context_overflow', 'runtime_failure'}


@dataclass(frozen=True)
class InferenceRequest:
    run_id: str
    prompt: str
    max_output_tokens: int = 128
    timeout_seconds: float = 30.0

    def __post_init__(self):
        if not isinstance(self.run_id, str) or not 1 <= len(self.run_id) <= 128:
            raise ValueError('Invalid run ID')
        if not isinstance(self.prompt, str) or not self.prompt.strip() or len(self.prompt) > 32000:
            raise ValueError('Prompt must contain 1-32000 characters')
        if type(self.max_output_tokens) is not int or not 1 <= self.max_output_tokens <= 4096:
            raise ValueError('Invalid output token limit')
        if not isinstance(self.timeout_seconds, (int, float)) or isinstance(self.timeout_seconds, bool) or not math.isfinite(self.timeout_seconds) or not 0 < self.timeout_seconds <= 300:
            raise ValueError('Invalid timeout')


@dataclass(frozen=True)
class InferenceResult:
    run_id: str
    outcome: Outcome
    answer: str | None
    termination_reason: str
    model_identity: str
    adapter_identity: str | None = None
    elapsed_seconds: float = 0.0
    input_tokens: int | None = None
    output_tokens: int | None = None
    synthetic: bool = False

    def __post_init__(self):
        if not isinstance(self.outcome, str) or self.outcome not in OUTCOMES:
            raise ValueError('Unknown inference outcome')
        for value, maximum in ((self.run_id, 128), (self.model_identity, 1024), (self.termination_reason, 1024)):
            if not isinstance(value, str) or not value.strip() or len(value) > maximum:
                raise ValueError('Inference provenance and termination reason are required')
        if self.adapter_identity is not None and (not isinstance(self.adapter_identity, str) or not self.adapter_identity.strip()):
            raise ValueError('Inference provenance and termination reason are required')
        if type(self.synthetic) is not bool:
            raise ValueError('Synthetic status must be a boolean')
        if self.outcome == 'success' and (not isinstance(self.answer, str) or not self.answer.strip()):
            raise ValueError('Successful inference requires a nonempty answer')
        if self.outcome != 'success' and self.answer is not None:
            raise ValueError('Failed inference must never contain an answer')
        if type(self.elapsed_seconds) not in (int, float) or not math.isfinite(self.elapsed_seconds) or self.elapsed_seconds < 0:
            raise ValueError('Invalid elapsed time')
        for value in (self.input_tokens, self.output_tokens):
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError('Invalid token count')


class InferenceBackend(Protocol):
    def generate(self, request: InferenceRequest) -> InferenceResult: ...


class FakeInference:
    def __init__(self, outcome: Outcome = 'success'):
        if outcome not in OUTCOMES:
            raise ValueError('Unknown fake outcome')
        self.outcome = outcome

    def generate(self, request: InferenceRequest) -> InferenceResult:
        return InferenceResult(run_id=request.run_id, outcome=self.outcome,
            answer='Synthetic transport fixture; no model was called.' if self.outcome == 'success' else None,
            termination_reason='fixture_' + self.outcome, model_identity='fake://transport-v1',
            synthetic=True)
