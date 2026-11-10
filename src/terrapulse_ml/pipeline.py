
from importlib import import_module

from .contracts import AnalysisRequest, AnalysisResult
from .modes.registry import MODE_MODULES


def run_pipeline(request: AnalysisRequest) -> AnalysisResult:

    if not isinstance(request, AnalysisRequest):
        raise TypeError("Expected AnalysisRequest")

    module_name = MODE_MODULES[request.mode]

    module = import_module(
        f".modes.{module_name}",
        package=__package__
    )

    analyze_function = getattr(module, "analyze", None)

    if not callable(analyze_function):
        return AnalysisResult(
            mode=request.mode,
            status="failed",
            error=f"{request.mode.value} analysis is not implemented yet"
        )

    try:
        result = analyze_function(request)

        if not isinstance(result, AnalysisResult):
            raise TypeError("Invalid analysis result")

        if result.mode != request.mode:
            raise ValueError("Result mode does not match request")

        return result

    except Exception as error:
        return AnalysisResult(
            mode=request.mode,
            status="failed",
            error=str(error)
        )
 