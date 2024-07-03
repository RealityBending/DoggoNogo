using CSV
using DataFrames
using Turing
using SequentialSamplingModels
using StatsModels
using StatsPlots
using CairoMakie
using Downloads
using JLD2


include(Downloads.download("https://raw.githubusercontent.com/RealityBending/scripts/main/data_grid.jl"))
include(Downloads.download("https://raw.githubusercontent.com/RealityBending/scripts/main/data_poly.jl"))


# Data ==========================================================================================

cd(@__DIR__)  # pwd()
df = CSV.read("../data/data_game.csv", DataFrame)


# Models ========================================================================================
# Exgaussian ------------------------------------------------------------------------------------
@model function model_exgaussian(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ truncated(Normal(0.4, 1), 0.0, Inf)
    drift_isi1 ~ Normal(0, 1)
    drift_isi2 ~ Normal(0, 1)

    σ ~ truncated(Normal(0, 1), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, Inf)

    for i in 1:length(data)
        drift = drift_intercept
        drift += drift_isi1 * isi[i, 1]
        drift += drift_isi2 * isi[i, 2]
        data[i] ~ ExGaussian(drift, σ, τ)
    end
end



# Wald ------------------------------------------------------------------------------------------
@model function model_wald(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ truncated(Normal(5, 2), 0.0, Inf)
    drift_isi1 ~ Normal(0, 1)
    drift_isi2 ~ Normal(0, 1)

    # Priors
    α ~ truncated(Normal(0.5, 0.4), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)

    for i in 1:length(data)
        drift = drift_intercept
        drift += drift_isi1 * isi[i, :1]
        drift += drift_isi2 * isi[i, :2]
        data[i] ~ Wald(drift, α, τ)
    end
end


# Sampling =======================================================================================
model = model_exgaussian(df.RT, min_rt=minimum(df.RT), isi=df.ISI)
chain_exgaussian = sample(model, NUTS(), 1000)
jldsave("models/chain_exgaussian_notmixed.jld2"; chain_exgaussian)

model = model_wald(df.RT, min_rt=minimum(df.RT), isi=df.ISI)
chain_wald = sample(model, NUTS(), 1000)
jldsave("models/chain_wald_notmixed.jld2"; chain_wald)




# Visualize =====================================================================================
chain_exgaussian = jldopen("models/chain_exgaussian_notmixed.jld2", "r+")["chain_exgaussian"]
chain_wald = jldopen("models/chain_wald_notmixed.jld2", "r+")["chain_wald"]

summarystats(chain_exgaussian)
StatsPlots.plot(chain_exgaussian; size=(600, 2000))


# PP Check --------------------------------------------------------------------------------------
# Generate predictions
pred = predict(model_exgaussian([missing for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_exgaussian)
pred_rt_exgaussian = Array(pred)

pred = predict(model_wald([missing for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_wald)
pred_rt_wald = Array(pred)

# Plot density
f = Figure()
ax1 = Axis(f[1, 1], title="ExGaussian")
for i in 1:500
    lines!(ax1, Makie.KernelDensity.kde(pred_rt_exgaussian[i, :]), color="orange", alpha=0.05)
end
ax2 = Axis(f[2, 1], title="Wald")
for i in 1:500
    lines!(ax2, Makie.KernelDensity.kde(pred_rt_wald[i, :]), color="green", alpha=0.05)
end

for ax in [ax1, ax2]
    lines!(ax, Makie.KernelDensity.kde(df.RT), color="black")
    GLMakie.xlims!(ax, (0.15, 0.8))
end
f
save("models/models_nonrandom.png", f)

# ISI -------------------------------------------------------------------------------------------
grid = data_grid(df.ISI)

pred = predict(model_exgaussian([(missing) for i in 1:length(grid)]; min_rt=minimum(df.RT), isi=grid), chain_exgaussian)
pred_exgaussian = Array(pred)

pred = predict(model_wald([(missing) for i in 1:length(grid)]; min_rt=minimum(df.RT), isi=grid), chain_wald)
pred_wald = Array(pred)

# Plot 

function make_plot(f, pred, title="ExGaussian")
    xaxis = collect(1:length(grid)) * 10
    Axis(f[1, 1],
        title="ExGaussian",
        xticks=(xaxis, string.(round.(grid; digits=2))))
    for (i, isi) in enumerate(grid)
        CairoMakie.density!(pred_exgaussian[:, i], offset=i * 10, direction=:y,
            color=:y, colormap=:thermal, colorrange=(0, 2))
    end
    lines!(xaxis, vec(mean(pred_exgaussian, dims=1)), color="black")
    return f
end

f = Figure()
f = make_plot(f, pred_exgaussian, "ExGaussian")
f = make_plot(f, pred_wald, "Wald")
f





