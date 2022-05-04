const { parseEther } = require("@ethersproject/units")
const sleep = require('util').promisify(setTimeout)
const { getStats, predictionContract, getBNBPrice, checkBalance, reduceWaitingTimeByTwoBlocks, saveRound } = require("./lib")
const { TradingViewScan, SCREENERS_ENUM, EXCHANGES_ENUM, INTERVALS_ENUM } = require("trading-view-recommends-parser-nodejs")

// Global Config
const GLOBAL_CONFIG = {
    BET_AMOUNT: 1, // in USD
    DAILY_GOAL: 20, // in USD,
    WAITING_TIME: 261000, // in Miliseconds (4.3 Minutes)
    THRESHOLD: 50 // Minimum % of certainty of signals (50 - 100)
}

//Bet UP
const betUp = async (amount, epoch) => {
    try {
        const tx = await predictionContract.betBull(epoch, {
            value: parseEther(amount.toFixed(18).toString()),
        })
        await tx.wait()
        console.log(`🤞 Successful bet of ${amount} BNB to UP 🍀`)
    } catch (error) {
        console.log("Transaction Error", error)
        GLOBAL_CONFIG.WAITING_TIME = reduceWaitingTimeByTwoBlocks(GLOBAL_CONFIG.WAITING_TIME)
    }
}

//Bet DOWN
const betDown = async (amount, epoch) => {
    try {
        const tx = await predictionContract.betBear(epoch, {
            value: parseEther(amount.toFixed(18).toString()),
        })
        await tx.wait()
        console.log(`🤞 Successful bet of ${amount} BNB to DOWN 🍁`)
    } catch (error) {
        console.log("Transaction Error", error)
        GLOBAL_CONFIG.WAITING_TIME = reduceWaitingTimeByTwoBlocks(GLOBAL_CONFIG.WAITING_TIME)
    }
}

//Check Signals
const getSignals = async () => {
    //1 Minute signals
    let resultMin = await new TradingViewScan(
        SCREENERS_ENUM["crypto"],
        EXCHANGES_ENUM["BINANCE"],
        "BNBUSDT",
        INTERVALS_ENUM["1m"]
    ).analyze()
    let minObj = JSON.stringify(resultMin.summary)
    let minRecomendation = JSON.parse(minObj)

    //5 Minute signals
    let resultMed = await new TradingViewScan(
        SCREENERS_ENUM["crypto"],
        EXCHANGES_ENUM["BINANCE"],
        "BNBUSDT",
        INTERVALS_ENUM["5m"]
    ).analyze()
    let medObj = JSON.stringify(resultMed.summary)
    let medRecomendation = JSON.parse(medObj)

    //Average signals
    if (minRecomendation && medRecomendation) {
        let averageBuy = (parseInt(minRecomendation.BUY) + parseInt(medRecomendation.BUY)) / 2
        let averageSell = (parseInt(minRecomendation.SELL) + parseInt(medRecomendation.SELL)) / 2
        let averageNeutral = (parseInt(minRecomendation.NEUTRAL) + parseInt(medRecomendation.NEUTRAL)) / 2

        return {
            buy: averageBuy,
            sell: averageSell,
            neutral: averageNeutral
        }
    } else {
        return false
    }
}

//Percentage difference
const percentage = (a, b) => {
    return parseInt(100 * a / (a + b))
}

//Strategy of betting
const strategy = async (minAcurracy, epoch) => {
    let BNBPrice
    let earnings = await getStats()
    if (earnings.profit_USD >= GLOBAL_CONFIG.DAILY_GOAL) {
        console.log("🧞 Daily goal reached. Shuting down... ✨ ")
        process.exit()
    }
    try {
        BNBPrice = await getBNBPrice()
    } catch (err) {
        return
    }
    let signals = await getSignals()
    if (signals) {
        if (signals.buy > signals.sell && percentage(signals.buy, signals.sell) > minAcurracy) {
            console.log(`${epoch.toString()} 🔮 Prediction: UP 🟢 ${percentage(signals.buy, signals.sell)}%`)
            await betUp((GLOBAL_CONFIG.BET_AMOUNT / BNBPrice), epoch)
            await saveRound(epoch.toString(), [{ round: epoch.toString(), betAmount: (GLOBAL_CONFIG.BET_AMOUNT / BNBPrice).toString(), bet: "bull" }])
        } else if (signals.sell > signals.buy && percentage(signals.sell, signals.buy) > minAcurracy) {
            console.log(`${epoch.toString()} 🔮 Prediction: DOWN 🔴 ${percentage(signals.sell, signals.buy)}%`)
            await betDown((GLOBAL_CONFIG.BET_AMOUNT / BNBPrice), epoch)
            await saveRound(epoch.toString(), [{ round: epoch.toString(), betAmount: (GLOBAL_CONFIG.BET_AMOUNT / BNBPrice).toString(), bet: "bear" }])
        } else {
            let lowPercentage
            if (signals.buy > signals.sell) {
                lowPercentage = percentage(signals.buy, signals.sell)
            } else {
                lowPercentage = percentage(signals.sell, signals.buy)
            }
            console.log("Waiting for next round 🕑", lowPercentage + "%")
        }
    } else {
        console.log("Error obtaining signals")
    }
}

//Check balance
checkBalance(GLOBAL_CONFIG.AMOUNT_TO_BET)
console.log('🤗 Welcome! Waiting for next round...')

//Betting
predictionContract.on("StartRound", async (epoch) => {
    console.log("🥞 Starting round " + epoch.toString())
    console.log("🕑 Waiting " + (GLOBAL_CONFIG.WAITING_TIME / 60000).toFixed(1) + " minutes")
    await sleep(GLOBAL_CONFIG.WAITING_TIME)
    await strategy(GLOBAL_CONFIG.THRESHOLD, epoch)
})

//Show stats
predictionContract.on("EndRound", async (epoch) => {
    await saveRound(epoch)
    let stats = await getStats()
    console.log('--------------------------------')
    console.log(`🍀 Fortune: ${stats.percentage}`)
    console.log(`👍 ${stats.win}|${stats.loss} 👎 `)
    console.log(`💰 Profit: ${stats.profit_USD.toFixed(3)} USD`)
    console.log('--------------------------------')
})
