# UBO Mapper

Ownership chart and UBO check. Download as PNG or PDF.

- Each row is one link: a person or entity, the company/foundation, and the type:
  shares %, votes %, founder/settlor, trustee/council, protector, beneficiary,
  owner via nominee, other control (veto rights, appointing the board), senior manager,
  or listed (company in the first box, stock exchange in the second).
- Owners are placed above what they own. Solid lines are shares; dashed lines are
  votes, control or trust/foundation roles.
- A UBO is always a natural person: a company, trust or foundation is never a UBO, however much
  it owns. The app tells people from entities by their place in the chart and their name
  (Ltd, Trust, ...); a Person / Entity switch fixes any wrong guess.
- A UBO is anyone who, at the threshold you set (25% by default, "at least" or
  "more than"):
  - owns enough, directly or through other companies; or
  - holds enough of the votes; or
  - has majority control of a company that owns or controls enough; or
  - is founder, trustee/council, protector or beneficiary of a trust or foundation
    that owns or controls enough (no % needed); or
  - has other control. Nominees are never UBOs; the person behind them is.
  - If nobody qualifies, the senior manager is named instead.
- Listed companies publish their shareholders, so they are not looked through:
  a listed main company needs no UBO, and owners above a listed company are not traced.
- Each UBO comes with the reason, e.g. "Founder of Falcon Foundation, which owns 60% of Northgate".
- Warnings point out missing or excess shares/votes, circular ownership, trusts or
  foundations missing a founder, trustee or beneficiaries, nominees with no real
  owner listed, and structures where no UBO is found.
- Your list is saved in your browser. Nothing is sent to a server.

## Run it

```
npm install     # first time only
npm run dev
```

Then open http://localhost:3000.

`npm test` checks the ownership calculations.

## Files

- `app/page.tsx`: the page (the list, owners summary and download buttons)
- `components/OrgChart.tsx`: draws the chart
- `lib/ownership.ts`: chart layout and effective-ownership maths
- `lib/download.ts`: PNG and PDF download
